    /* ----------------------------------------------------
       APPLICATION STATE
    ---------------------------------------------------- */
    let products = [];
    let trades = (JSON.parse(localStorage.getItem('cr_trades')) || []).filter(trade => trade.proposerEmail);
    let orders = (JSON.parse(localStorage.getItem('cr_orders')) || []).filter(order => order.buyerEmail);
    let currentUser = null;
    let supabaseClient = null;
    let cart = [];
    let pendingAuthAction = null;
    let authMode = 'login';
    let promoDiscountPercent = 0;
    let activeFilterCategory = "All";
    let activeSearchTerm = "";
    let activeMaxPrice = 3500;
    let selectedConditions = [];
    let tradeOnlyFilter = false;

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]);
    }

    function jsArgument(value) {
      return escapeHtml(JSON.stringify(String(value)));
    }

    function safeImageUrl(value) {
      try {
        const url = new URL(value, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    }

    // Save states
    function persistData() {
      localStorage.setItem('cr_trades', JSON.stringify(trades));
      localStorage.setItem('cr_orders', JSON.stringify(orders));
      updateCartBadges();
      updateDashboardCounts();
    }

    /* ----------------------------------------------------
       INITIALIZATION
    ---------------------------------------------------- */
    document.addEventListener('DOMContentLoaded', async () => {
      renderCategoryFilters();
      renderTradesFeed();
      renderCart();
      populateTargetDeviceDropdown();
      updateCartBadges();
      updateDashboardCounts();
      updateAuthButton();
      setupScrollReveals();
      try {
        const config = window.ZEL_SUPABASE_CONFIG;
        if (!window.supabase || !config || !config.url || !config.publishableKey) {
          throw new Error('Supabase client configuration is unavailable.');
        }
        supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (data.session) await hydrateCurrentUser(data.session.user);
        await loadListings();
      } catch (error) {
        console.error('Unable to initialize the Supabase marketplace.', error);
        showToast(`Marketplace connection failed: ${error.message || 'Check Supabase configuration.'}`);
      } finally {
        updateAuthButton();
        renderCatalog();
        populateTargetDeviceDropdown();
        updateDashboardCounts();
        window.setTimeout(() => document.getElementById('pageLoader').classList.add('page-loader-hidden'), 900);
      }
    });

    /* ----------------------------------------------------
       NAVIGATION ROUTING
    ---------------------------------------------------- */
    function switchView(viewName) {
      if ((viewName === 'sellPortal' || viewName === 'dashboard') && !requireSignIn(() => switchView(viewName))) return;
      const views = ['shop', 'tradeHub', 'sellPortal', 'dashboard'];
      views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        const navBtn = document.getElementById(`nav-${v}`);
        if (el) el.classList.add('hidden');
        if (navBtn) {
          navBtn.classList.remove('text-cyber-red', 'bg-cyber-red/10', 'border-cyber-red/30');
          navBtn.classList.add('text-gray-300');
        }
      });

      const target = document.getElementById(`view-${viewName}`);
      const activeNav = document.getElementById(`nav-${viewName}`);
      if (target) target.classList.remove('hidden');
      if (activeNav) {
        activeNav.classList.add('text-cyber-red', 'bg-cyber-red/10', 'border-cyber-red/30');
        activeNav.classList.remove('text-gray-300');
      }

      if (viewName === 'dashboard') {
        renderUserDashboard();
        target.classList.remove('dashboard-boot');
        void target.offsetWidth;
        target.classList.add('dashboard-boot');
        setupScrollReveals(target);
      } else if (viewName === 'tradeHub') {
        renderTradesFeed();
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function toggleMobileMenu() {
      const menu = document.getElementById('mobileMenu');
      menu.classList.toggle('hidden');
    }

    function updateAuthButton() {
      const button = document.getElementById('authButton');
      if (!button) return;
      button.textContent = currentUser ? 'LOG OUT' : 'LOG IN';
      button.onclick = currentUser ? logOut : () => openAuthModal('login');
      button.title = currentUser ? `Signed in as ${currentUser.email}` : 'Log in to list, trade, or buy';
    }

    function openAuthModal(mode = 'login') {
      setAuthMode(mode);
      const modal = document.getElementById('authModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('authEmail').focus();
    }

    function setAuthMode(mode) {
      authMode = mode;
      const isRegistration = mode === 'register';
      document.getElementById('authTitle').textContent = isRegistration ? 'CREATE YOUR ACCOUNT' : 'LOG IN TO CONTINUE';
      document.getElementById('authDescription').textContent = isRegistration
        ? 'Create an account to list, trade, and buy electronics on ZEL.'
        : 'Log in to list electronics, propose trades, and buy from other members.';
      document.getElementById('authNameField').classList.toggle('hidden', !isRegistration);
      document.getElementById('authName').required = isRegistration;
      document.getElementById('authConfirmPasswordField').classList.toggle('hidden', !isRegistration);
      document.getElementById('authConfirmPassword').required = isRegistration;
      document.getElementById('authPassword').autocomplete = isRegistration ? 'new-password' : 'current-password';
      document.getElementById('authSubmitButton').textContent = isRegistration ? 'Create account' : 'Log in';
      document.getElementById('authModeToggle').textContent = isRegistration
        ? 'Already have an account? Log in'
        : 'New here? Create an account';
    }

    function closeAuthModal() {
      const modal = document.getElementById('authModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.getElementById('authForm').reset();
      pendingAuthAction = null;
    }

    function requireSignIn(action) {
      if (currentUser) return true;
      pendingAuthAction = action || null;
      openAuthModal();
      return false;
    }

    async function handleSignIn(event) {
      event.preventDefault();
      const name = authMode === 'register'
        ? document.getElementById('authName').value.trim()
        : document.getElementById('authEmail').value.trim().split('@')[0];
      const email = document.getElementById('authEmail').value.trim().toLowerCase();
      const isRegistration = authMode === 'register';
      if (isRegistration && !name) {
        showToast('Enter a display name for your account.');
        return;
      }
      if (isRegistration && document.getElementById('authPassword').value !== document.getElementById('authConfirmPassword').value) {
        showToast('Passwords do not match.');
        return;
      }
      if (!supabaseClient) {
        showToast('The account service is unavailable. Please try again later.');
        return;
      }

      const submitButton = document.getElementById('authSubmitButton');
      submitButton.disabled = true;
      submitButton.textContent = isRegistration ? 'Creating account...' : 'Logging in...';
      try {
        let result;
        if (isRegistration) {
          result = await supabaseClient.auth.signUp({
            email,
            password: document.getElementById('authPassword').value,
            options: { data: { display_name: name } }
          });
        } else {
          result = await supabaseClient.auth.signInWithPassword({
            email,
            password: document.getElementById('authPassword').value
          });
        }
        if (result.error) throw result.error;
        if (!result.data.session) {
          document.getElementById('authForm').reset();
          setAuthMode('login');
          showToast('Check your email to confirm your account, then log in.');
          return;
        }

        await hydrateCurrentUser(result.data.user);
        try {
          await loadListings();
        } catch (error) {
          console.error('Unable to load marketplace listings.', error);
          showToast(`Listings are unavailable: ${error.message || 'Check the Supabase setup.'}`);
        }
        document.getElementById('authForm').reset();
        setAuthMode('login');
        updateAuthButton();
        renderCatalog();
        renderTradesFeed();
        updateDashboardCounts();
        const action = pendingAuthAction;
        pendingAuthAction = null;
        closeAuthModal();
        showToast(isRegistration ? `Welcome, ${currentUser.name}!` : `Signed in as ${currentUser.name || email}.`);
        if (action) action();
      } catch (error) {
        console.error('Authentication failed.', error);
        showToast(`Unable to ${isRegistration ? 'create account' : 'log in'}: ${error.message || 'Please try again.'}`);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = authMode === 'register' ? 'Create account' : 'Log in';
      }
    }

    async function hydrateCurrentUser(user) {
      if (!user) {
        currentUser = null;
        return;
      }
      const metadataName = user.user_metadata && user.user_metadata.display_name;
      currentUser = {
        id: user.id,
        email: user.email,
        name: metadataName || user.email.split('@')[0]
      };
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.error('Unable to load the member profile.', error);
        showToast(`Profile details are unavailable: ${error.message}`);
        return;
      }
      if (data && data.display_name) currentUser.name = data.display_name;
    }

    async function loadListings() {
      const { data, error } = await supabaseClient
        .from('listings')
        .select('id, seller_id, title, category, condition, price, trade_value, trade_eligible, specs, image, rating, stock, description, seller:profiles(display_name)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      products = (data || []).map(listing => ({
        id: listing.id,
        sellerId: listing.seller_id,
        title: listing.title,
        category: listing.category,
        condition: listing.condition,
        price: Number(listing.price),
        tradeValue: Number(listing.trade_value),
        tradeEligible: listing.trade_eligible,
        specs: listing.specs,
        image: safeImageUrl(listing.image),
        rating: Number(listing.rating),
        stock: listing.stock,
        description: listing.description,
        sellerName: listing.seller && listing.seller.display_name
      }));
      renderCatalog();
      populateTargetDeviceDropdown();
      updateDashboardCounts();
    }

    async function logOut() {
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error('Logout failed.', error);
        showToast(`Unable to log out: ${error.message}`);
        return;
      }
      currentUser = null;
      cart = [];
      persistData();
      renderCart();
      updateAuthButton();
      renderCatalog();
      renderTradesFeed();
      switchView('shop');
      showToast('You have been logged out.');
    }

    function scrollToCatalog() {
      document.getElementById('catalogSection').scrollIntoView({ behavior: 'smooth' });
    }

    /* ----------------------------------------------------
       CATALOG & FILTER LOGIC
    ---------------------------------------------------- */
    const categories = [
      "All", "Smartphones", "Laptops", "Tablets", "Gaming Consoles", "Custom PCs / Parts", "Audio & Accessories"
    ];

    function renderCategoryFilters() {
      const container = document.getElementById('categoryFilterContainer');
      container.innerHTML = categories.map(cat => `
        <button onclick="filterByCategory('${cat}')" 
          class="w-full text-left px-3 py-1.5 rounded transition flex items-center justify-between ${activeFilterCategory === cat ? 'bg-cyber-red text-white font-bold' : 'hover:bg-cyber-dark text-gray-300'}">
          <span>${cat}</span>
          <span class="text-[10px] opacity-75">${getCategoryCount(cat)}</span>
        </button>
      `).join('');
    }

    function getCategoryCount(cat) {
      if (cat === "All") return products.length;
      return products.filter(p => p.category === cat).length;
    }

    function filterByCategory(cat) {
      activeFilterCategory = cat;
      renderCategoryFilters();
      applyFilters();
    }

    function handleSearch(val) {
      activeSearchTerm = val.toLowerCase().trim();
      applyFilters();
    }

    function updatePriceFilter(val) {
      activeMaxPrice = parseFloat(val);
      document.getElementById('priceLabel').innerText = `$${activeMaxPrice.toLocaleString()}`;
      applyFilters();
    }

    function resetFilters() {
      activeFilterCategory = "All";
      activeSearchTerm = "";
      activeMaxPrice = 3500;
      document.getElementById('priceRange').value = 3500;
      document.getElementById('priceLabel').innerText = "$3,500";
      document.getElementById('globalSearch').value = "";
      document.getElementById('tradeOnlyFilter').checked = false;
      document.querySelectorAll('input[name="conditionFilter"]').forEach(cb => cb.checked = false);
      renderCategoryFilters();
      applyFilters();
      showToast("Filters reset to default.");
    }

    function applyFilters() {
      // Gather checked conditions
      const checkboxes = document.querySelectorAll('input[name="conditionFilter"]:checked');
      selectedConditions = Array.from(checkboxes).map(cb => cb.value);
      tradeOnlyFilter = document.getElementById('tradeOnlyFilter').checked;

      const sortBy = document.getElementById('sortSelector').value;

      let filtered = products.filter(item => {
        // Category
        if (activeFilterCategory !== "All" && item.category !== activeFilterCategory) return false;
        // Search
        if (activeSearchTerm && !item.title.toLowerCase().includes(activeSearchTerm) && !item.specs.toLowerCase().includes(activeSearchTerm)) return false;
        // Price
        if (item.price > activeMaxPrice) return false;
        // Condition
        if (selectedConditions.length > 0) {
          const match = selectedConditions.some(cond => item.condition.includes(cond));
          if (!match) return false;
        }
        // Trade eligible
        if (tradeOnlyFilter && !item.tradeEligible) return false;

        return true;
      });

      // Sorting
      if (sortBy === 'price-asc') filtered.sort((a,b) => a.price - b.price);
      if (sortBy === 'price-desc') filtered.sort((a,b) => b.price - a.price);
      if (sortBy === 'newest') filtered.reverse();

      renderProductsGrid(filtered);
    }

    function renderCatalog() {
      applyFilters();
    }

    function renderProductsGrid(items) {
      const grid = document.getElementById('productsGrid');
      document.getElementById('productCount').innerText = items.length;

      if (items.length === 0) {
        grid.innerHTML = `
          <div class="col-span-full py-16 text-center space-y-3 bg-cyber-card rounded-xl border border-cyber-border">
            <i class="fa-solid fa-box-open text-3xl text-cyber-red"></i>
            <h4 class="font-mono text-white text-base">${products.length ? 'NO HARDWARE MATCHES YOUR CRITERIA' : 'NO COMMUNITY LISTINGS YET'}</h4>
            <p class="text-xs text-cyber-muted">${products.length ? 'Try resetting search keywords or expanding price filters.' : 'Log in and list your electronics to start the marketplace.'}</p>
            ${products.length ? '<button onclick="resetFilters()" class="px-4 py-2 bg-cyber-red text-white text-xs font-mono rounded">Clear All Filters</button>' : '<button onclick="switchView(&quot;sellPortal&quot;)" class="px-4 py-2 bg-cyber-red text-white text-xs font-mono rounded">List an electronic</button>'}
          </div>
        `;
        return;
      }

      grid.innerHTML = items.map(p => {
        const isOwnListing = currentUser && p.sellerId === currentUser.id;
        const conditionColor = p.condition === 'Brand New' 
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
          : p.condition === 'Refurbished' 
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
            : 'bg-amber-500/10 text-amber-400 border-amber-500/30';

        return `
          <div class="tech-card reveal-on-scroll bg-cyber-card border border-cyber-border hover:border-cyber-red rounded-xl overflow-hidden flex flex-col justify-between group transition duration-300 hover:shadow-neon-sm">
            
            <!-- Image & Badges -->
            <div class="relative h-48 bg-cyber-dark overflow-hidden">
              <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
              
              <!-- Condition Badge -->
              <div class="absolute top-2.5 left-2.5">
                <span class="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border ${conditionColor}">
                  ${escapeHtml(p.condition)}
                </span>
              </div>

              <!-- Trade eligible indicator -->
              ${p.tradeEligible ? `
                <div class="absolute top-2.5 right-2.5">
                  <span class="px-2 py-0.5 bg-cyber-black/80 backdrop-blur border border-cyber-red/50 text-cyber-red rounded text-[10px] font-mono font-bold flex items-center">
                    <i class="fa-solid fa-arrows-rotate mr-1"></i> Trade Eligible
                  </span>
                </div>
              ` : ''}

              <!-- Stock Tag -->
              <div class="absolute bottom-2 left-2.5 text-[9px] font-mono bg-black/70 px-2 py-0.5 rounded text-gray-300">
                ${p.stock} units available
              </div>
            </div>

            <!-- Card Body -->
            <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div>
                <span class="text-[10px] font-mono text-cyber-muted uppercase tracking-wider block">${escapeHtml(p.category)}</span>
                <h4 class="font-mono text-sm font-bold text-white group-hover:text-cyber-red transition line-clamp-1 cursor-pointer" onclick="openProductModal(${jsArgument(p.id)})">
                  ${escapeHtml(p.title)}
                </h4>
                <p class="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                  ${escapeHtml(p.specs)}
                </p>
                <p class="text-[10px] text-cyber-muted mt-2">Listed by ${escapeHtml(p.sellerName || 'ZEL member')}</p>
              </div>

              <!-- Pricing & Trade Value Breakdown -->
              <div class="pt-2 border-t border-cyber-border/70">
                <div class="flex items-baseline justify-between">
                  <div>
                    <span class="text-xs text-cyber-muted block text-[10px] font-mono">PURCHASE PRICE</span>
                    <span class="text-lg font-mono font-bold text-white">$${p.price.toLocaleString()}</span>
                  </div>
                  <div class="text-right">
                    <span class="text-xs text-cyber-red block text-[10px] font-mono">EST. TRADE VALUE</span>
                    <span class="text-xs font-mono font-bold text-cyber-red">~$${p.tradeValue.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <!-- Action Buttons -->
              <div class="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                <button ${isOwnListing ? 'disabled' : ''} onclick="addToCart(${jsArgument(p.id)})" class="w-full py-2 bg-cyber-card hover:bg-cyber-red text-white border border-cyber-border hover:border-cyber-red rounded font-semibold transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                  <i class="fa-solid fa-cart-plus mr-1.5 text-xs"></i> ${isOwnListing ? 'Your Listing' : 'Buy Now'}
                </button>
                <button ${isOwnListing || !p.tradeEligible ? 'disabled' : ''} onclick="openTradeProposalForProduct(${jsArgument(p.id)})" class="w-full py-2 bg-cyber-red/10 hover:bg-cyber-red text-cyber-red hover:text-white border border-cyber-red/40 rounded font-semibold transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                  <i class="fa-solid fa-arrows-left-right mr-1.5 text-xs"></i> Trade In
                </button>
              </div>

            </div>
          </div>
        `;
      }).join('');
      setupScrollReveals(grid);
    }

    /* ----------------------------------------------------
       PRODUCT DETAILS MODAL
    ---------------------------------------------------- */
    function openProductModal(prodId) {
      const item = products.find(p => p.id === prodId);
      if (!item) return;

      const modal = document.getElementById('productDetailModal');
      const content = document.getElementById('productModalContent');

      content.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-3">
            <div class="h-64 rounded-xl bg-cyber-dark overflow-hidden border border-cyber-border">
              <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="w-full h-full object-cover">
            </div>
            <div class="bg-cyber-dark p-3 rounded-lg border border-cyber-border space-y-1 text-xs font-mono">
              <span class="text-cyber-muted block">GUARANTEED AUTHENTICITY</span>
              <p class="text-green-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> ZEL Tech Inspection Passed</p>
              <p class="text-[11px] text-cyber-muted">Includes 1-Year Hardware Warranty &amp; Return Escrow.</p>
            </div>
          </div>

          <div class="space-y-4">
            <div>
              <span class="text-xs font-mono text-cyber-red uppercase tracking-wider">${escapeHtml(item.category)} • ${escapeHtml(item.condition)}</span>
              <h2 class="text-xl font-mono font-bold text-white mt-0.5">${escapeHtml(item.title)}</h2>
              <div class="flex items-center space-x-2 mt-1 text-amber-400 text-xs">
                <div>★★★★★</div>
                <span class="text-cyber-muted text-[11px] font-mono">(${item.rating} / 5.0 Rating)</span>
              </div>
            </div>

            <p class="text-xs text-gray-300 leading-relaxed">
              ${escapeHtml(item.description)}
            </p>

            <div class="bg-cyber-dark p-3.5 rounded-lg border border-cyber-border space-y-2 text-xs font-mono">
              <span class="text-cyber-muted uppercase text-[10px] block">Hardware Specifications</span>
              <p class="text-white">${escapeHtml(item.specs)}</p>
            </div>

            <div class="flex items-baseline justify-between pt-2 border-t border-cyber-border">
              <div>
                <span class="text-[10px] font-mono text-cyber-muted block">CASH OUTRIGHT</span>
                <span class="text-2xl font-mono font-black text-white">$${item.price.toLocaleString()}</span>
              </div>
              <div class="text-right">
                <span class="text-[10px] font-mono text-cyber-red block">TRADE CREDIT ALLOWANCE</span>
                <span class="text-sm font-mono font-bold text-cyber-red">Up to $${item.tradeValue.toLocaleString()} Off</span>
              </div>
            </div>

            <div class="space-y-2 pt-2">
              <button onclick="addToCart(${jsArgument(item.id)}); closeProductModal();" class="w-full py-3 bg-cyber-red hover:bg-cyber-redGlow text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg shadow-neon transition flex items-center justify-center">
                <i class="fa-solid fa-cart-shopping mr-2"></i> Add To Cart — $${item.price.toLocaleString()}
              </button>
              <button onclick="closeProductModal(); openTradeProposalForProduct(${jsArgument(item.id)});" class="w-full py-2.5 bg-cyber-dark hover:bg-cyber-card border border-cyber-red/50 text-cyber-red hover:text-white font-mono text-xs uppercase font-bold rounded-lg transition flex items-center justify-center">
                <i class="fa-solid fa-arrow-right-arrow-left mr-2"></i> Exchange My Device For This
              </button>
            </div>
          </div>
        </div>
      `;

      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeProductModal() {
      const modal = document.getElementById('productDetailModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    /* ----------------------------------------------------
       SHOPPING CART ENGINE
    ---------------------------------------------------- */
    function addToCart(prodId) {
      if (!requireSignIn(() => addToCart(prodId))) return;
      const product = products.find(p => p.id === prodId);
      if (!product) return;
      if (product.sellerId === currentUser.id) {
        showToast('You cannot buy your own listing.');
        return;
      }

      const existingIndex = cart.findIndex(c => c.id === prodId);
      if (existingIndex > -1) {
        if (cart[existingIndex].qty >= product.stock) {
          showToast('This listing has no more units available.');
          return;
        }
        cart[existingIndex].qty += 1;
      } else {
        if (product.stock < 1) {
          showToast('This listing has already been sold.');
          return;
        }
        cart.push({
          id: product.id,
          title: product.title,
          price: product.price,
          image: product.image,
          condition: product.condition,
          sellerId: product.sellerId,
          qty: 1
        });
      }

      persistData();
      renderCart();
      showToast(`Added "${product.title}" to Cart`);
      toggleCartDrawer(true);
    }

    function updateCartQty(prodId, delta) {
      const item = cart.find(c => c.id === prodId);
      if (!item) return;

      item.qty += delta;
      if (item.qty <= 0) {
        cart = cart.filter(c => c.id !== prodId);
      }
      persistData();
      renderCart();
    }

    function removeCartItem(prodId) {
      cart = cart.filter(c => c.id !== prodId);
      persistData();
      renderCart();
      showToast("Item removed from cart");
    }

    function renderCart() {
      const container = document.getElementById('cartItemsContainer');
      const countBadge = document.getElementById('cartCountBadge');
      const subtotalEl = document.getElementById('cartSubtotal');
      const grandTotalEl = document.getElementById('cartGrandTotal');
      const discountRow = document.getElementById('cartDiscountRow');
      const discountEl = document.getElementById('cartDiscount');

      const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
      countBadge.innerText = totalItems;

      if (cart.length === 0) {
        container.innerHTML = `
          <div class="h-64 flex flex-col items-center justify-center text-center text-cyber-muted space-y-3 font-mono">
            <i class="fa-solid fa-cart-arrow-down text-3xl opacity-40"></i>
            <p class="text-xs">YOUR CART IS CURRENTLY EMPTY</p>
            <button onclick="toggleCartDrawer(false); switchView('shop')" class="text-xs text-cyber-red underline">Browse Available Tech</button>
          </div>
        `;
        subtotalEl.innerText = "$0.00";
        grandTotalEl.innerText = "$0.00";
        discountRow.style.display = 'none';
        return;
      }

      container.innerHTML = cart.map(item => `
        <div class="flex items-center space-x-3 bg-cyber-card p-3 rounded-lg border border-cyber-border">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="w-14 h-14 object-cover rounded bg-cyber-dark">
          <div class="flex-1 min-w-0 font-mono">
            <h5 class="text-xs font-bold text-white truncate">${escapeHtml(item.title)}</h5>
            <span class="text-[10px] text-cyber-muted block">${escapeHtml(item.condition)}</span>
            <div class="text-xs font-bold text-cyber-red mt-1">$${(item.price * item.qty).toLocaleString()}</div>
          </div>
          <div class="flex items-center space-x-1.5 font-mono">
            <button onclick="updateCartQty(${jsArgument(item.id)}, -1)" class="w-6 h-6 rounded bg-cyber-dark border border-cyber-border hover:border-cyber-red text-white flex items-center justify-center text-xs">-</button>
            <span class="text-xs font-bold px-1">${item.qty}</span>
            <button onclick="updateCartQty(${jsArgument(item.id)}, 1)" class="w-6 h-6 rounded bg-cyber-dark border border-cyber-border hover:border-cyber-red text-white flex items-center justify-center text-xs">+</button>
            <button onclick="removeCartItem(${jsArgument(item.id)})" class="ml-2 text-cyber-muted hover:text-cyber-red p-1"><i class="fa-solid fa-trash-can text-xs"></i></button>
          </div>
        </div>
      `).join('');

      const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const discount = subtotal * promoDiscountPercent;
      const grandTotal = Math.max(0, subtotal - discount);

      subtotalEl.innerText = `$${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      if (promoDiscountPercent > 0) {
        discountRow.style.display = 'flex';
        discountEl.innerText = `-$${discount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else {
        discountRow.style.display = 'none';
      }

      grandTotalEl.innerText = `$${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function toggleCartDrawer(open) {
      const drawer = document.getElementById('cartDrawer');
      if (open) {
        drawer.classList.remove('invisible', 'opacity-0', 'pointer-events-none');
        drawer.classList.add('opacity-100');
      } else {
        drawer.classList.add('opacity-0', 'pointer-events-none');
        drawer.classList.remove('opacity-100');
        window.setTimeout(() => {
          if (drawer.classList.contains('opacity-0')) drawer.classList.add('invisible');
        }, 300);
      }
    }

    function applyPromoCode() {
      const input = document.getElementById('promoCodeInput').value.trim().toUpperCase();
      const msg = document.getElementById('promoMessage');

      if (input === 'NEON2025' || input === 'CYBERTRADE') {
        promoDiscountPercent = 0.15; // 15% discount
        msg.className = "text-[11px] text-green-400 block font-mono";
        msg.innerText = "PROMO APPLIED: 15% Hardware Discount Active!";
        showToast("15% Promo Discount Code applied!");
      } else {
        promoDiscountPercent = 0;
        msg.className = "text-[11px] text-cyber-red block font-mono";
        msg.innerText = "Invalid Promo Code. Try: NEON2025";
      }
      renderCart();
    }

    function updateCartBadges() {
      const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
      document.getElementById('cartCountBadge').innerText = totalItems;
    }

    /* ----------------------------------------------------
       CHECKOUT & ESCROW SYSTEM
    ---------------------------------------------------- */
    function openCheckoutModal() {
      if (!requireSignIn(() => openCheckoutModal())) return;
      if (cart.length === 0) {
        showToast("Cart is empty! Add products first.");
        return;
      }
      toggleCartDrawer(false);

      const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const discount = subtotal * promoDiscountPercent;
      const payable = subtotal - discount;

      document.getElementById('checkoutPayableAmount').innerText = `$${payable.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      
      const modal = document.getElementById('checkoutModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeCheckoutModal() {
      const modal = document.getElementById('checkoutModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function processCheckout(e) {
      e.preventDefault();
      if (!requireSignIn(() => document.getElementById('checkoutForm').requestSubmit())) return;

      const btn = document.getElementById('btnConfirmPay');
      btn.classList.add('button-loading');
      btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Verifying Escrow Transaction...`;
      btn.disabled = true;

      setTimeout(() => {
        const orderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const discount = subtotal * promoDiscountPercent;
        const total = subtotal - discount;

        const newOrder = {
          id: orderId,
          date: new Date().toISOString().split('T')[0],
          items: [...cart],
          total: total,
          status: "Order Confirmed / Escrow Locked",
          trackingNumber: `CR-FEDEX-${Math.floor(100000000 + Math.random() * 900000000)}`,
          buyerEmail: currentUser.email
        };

        orders.unshift(newOrder);
        cart.forEach(item => {
          const product = products.find(listing => listing.id === item.id);
          if (product) product.stock -= item.qty;
        });
        products = products.filter(product => product.stock > 0);
        cart = [];
        promoDiscountPercent = 0;
        persistData();
        renderCart();

        btn.innerHTML = `<i class="fa-solid fa-lock mr-2"></i> Authorize &amp; Place Escrow Order`;
        btn.disabled = false;
        btn.classList.remove('button-loading');
        closeCheckoutModal();

        // Show Invoice Receipt
        document.getElementById('orderConfirmSubtitle').innerText = `Order #${newOrder.id} authorized into cyber escrow.`;
        document.getElementById('orderSuccessDetails').innerHTML = `
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Tracking Number:</span>
            <span class="text-cyber-red font-bold">${newOrder.trackingNumber}</span>
          </div>
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Items Purchased:</span>
            <span>${newOrder.items.length} units</span>
          </div>
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Total Escrow Paid:</span>
            <span class="text-white font-bold">$${newOrder.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div class="flex justify-between text-green-400">
            <span>Escrow Status:</span>
            <span>Funds Held Securely Until Delivery Verified</span>
          </div>
        `;

        const successModal = document.getElementById('orderSuccessModal');
        successModal.classList.remove('hidden');
        successModal.classList.add('flex');
      }, 1200);
    }

    function closeSuccessModal() {
      const modal = document.getElementById('orderSuccessModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function closeSuccessModalAndGoOrders() {
      closeSuccessModal();
      switchView('dashboard');
      switchDashTab('orders');
    }

    /* ----------------------------------------------------
       TRADE & BARTER SYSTEM
    ---------------------------------------------------- */
    function populateTargetDeviceDropdown(preselectId = null) {
      const select = document.getElementById('tradeTargetDeviceSelect');
      const availableProducts = products.filter(product => currentUser && product.sellerId !== currentUser.id);
      select.innerHTML = `<option value="" selected disabled>${availableProducts.length ? 'Choose a community listing' : 'No other-user listings available'}</option>` + availableProducts.map(p => `
        <option value="${escapeHtml(p.id)}" ${p.id === preselectId ? 'selected' : ''}>
          ${escapeHtml(p.title)} (${escapeHtml(p.condition)}) — Listed $${p.price}
        </option>
      `).join('');

      handleTargetSelectionChange();
    }

    function handleTargetSelectionChange() {
      const select = document.getElementById('tradeTargetDeviceSelect');
      const targetProd = products.find(p => p.id === select.value);
      document.getElementById('tradeTargetValue').value = targetProd ? targetProd.price : '';
      recalculateTradeBalance();
    }

    function openTradeProposalModal() {
      if (!requireSignIn(openTradeProposalModal)) return;
      populateTargetDeviceDropdown();
      const modal = document.getElementById('tradeProposalModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function openTradeProposalForProduct(prodId) {
      if (!requireSignIn(() => openTradeProposalForProduct(prodId))) return;
      const target = products.find(product => product.id === prodId);
      if (!target || target.sellerId === currentUser.id || !target.tradeEligible) {
        showToast('This listing is not available for a trade offer.');
        return;
      }
      populateTargetDeviceDropdown(prodId);
      const modal = document.getElementById('tradeProposalModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeTradeProposalModal() {
      const modal = document.getElementById('tradeProposalModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function autoSuggestEstimatedValue() {
      const cond = document.getElementById('tradeCondition').value;
      const myValInput = document.getElementById('tradeMyValue');
      
      let base = 600;
      if (cond === 'Mint') base = 680;
      if (cond === 'Good') base = 520;
      if (cond === 'Fair') base = 380;
      if (cond === 'Damaged Screen') base = 220;

      myValInput.value = base;
      recalculateTradeBalance();
    }

    function recalculateTradeBalance() {
      const myVal = parseFloat(document.getElementById('tradeMyValue').value) || 0;
      const targetVal = parseFloat(document.getElementById('tradeTargetValue').value) || 0;
      const cashDelta = parseFloat(document.getElementById('tradeCashDelta').value) || 0;
      const direction = document.getElementById('tradeCashDirection').value;

      let netOfferValue = myVal;
      if (direction === 'i_pay') {
        netOfferValue += cashDelta;
      } else {
        netOfferValue -= cashDelta;
      }

      const diff = netOfferValue - targetVal;
      const summaryText = document.getElementById('tradeSummaryText');

      if (!document.getElementById('tradeTargetDeviceSelect').value) {
        summaryText.textContent = "Select another user's listing to compare values";
      } else if (Math.abs(diff) < 20) {
        summaryText.innerHTML = `<span class="text-green-400 font-bold"><i class="fa-solid fa-circle-check"></i> Fair &amp; Balanced Exchange ($${netOfferValue} vs $${targetVal})</span>`;
      } else if (diff < 0) {
        summaryText.innerHTML = `<span class="text-amber-400 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Offer is $${Math.abs(diff)} lower than target. Consider adding cash top-up.</span>`;
      } else {
        summaryText.innerHTML = `<span class="text-cyber-red font-bold"><i class="fa-solid fa-arrow-trend-up"></i> Your offer exceeds target value by $${diff}! Advantageous for seller.</span>`;
      }
    }

    function simulateFileUpload() {
      document.getElementById('tradePhotoInput').click();
    }

    function handleTradePhotoSelection(event) {
      const input = event.currentTarget;
      const files = Array.from(input.files || []);
      const invalid = files.find(file => {
        const isImage = ['image/jpeg', 'image/png'].includes(file.type) || /\.(jpe?g|png)$/i.test(file.name);
        return !isImage || file.size > 10 * 1024 * 1024;
      });

      if (invalid) {
        input.value = '';
        const label = document.getElementById('fileUploadLabel');
        label.textContent = 'Click to attach photo or use sample image';
        label.classList.remove('text-green-400');
        label.classList.add('text-gray-300');
        showToast('Choose JPEG or PNG photos under 10 MB each.');
        return;
      }

      const label = document.getElementById('fileUploadLabel');
      label.textContent = files.length
        ? `${files.length} photo${files.length === 1 ? '' : 's'} selected: ${files.map(file => file.name).join(', ')}`
        : 'Click to attach photo or use sample image';
      label.classList.toggle('text-green-400', files.length > 0);
      label.classList.toggle('text-gray-300', files.length === 0);
    }

    function handleTradeSubmission(e) {
      e.preventDefault();
      if (!requireSignIn(() => document.getElementById('tradeProposalForm').requestSubmit())) return;

      const myDevice = document.getElementById('tradeMyDevice').value;
      const condition = document.getElementById('tradeCondition').value;
      const myValue = parseFloat(document.getElementById('tradeMyValue').value);
      const targetSelect = document.getElementById('tradeTargetDeviceSelect');
      const targetProduct = products.find(p => p.id === targetSelect.value);
      const cashDelta = parseFloat(document.getElementById('tradeCashDelta').value) || 0;
      const cashDirection = document.getElementById('tradeCashDirection').value;
      const notes = document.getElementById('tradeNotes').value;
      const photoFiles = Array.from(document.getElementById('tradePhotoInput').files || []);

      if (!photoFiles.length) {
        showToast('Attach at least one device condition photo to continue.');
        return;
      }
      if (!targetProduct || targetProduct.sellerId === currentUser.id || !Number.isFinite(myValue)) {
        showToast("Choose another user's listing and enter your device value.");
        return;
      }

      const newTrade = {
        id: `TRD-${Math.floor(1000 + Math.random() * 9000)}`,
        userDevice: myDevice,
        condition: condition,
        estimatedValue: myValue,
        targetProduct: targetProduct ? targetProduct.title : "Catalog Tech Item",
        cashDelta: cashDelta,
        cashDirection: cashDirection,
        photos: photoFiles.map(file => file.name),
        status: "Under Review",
        notes: notes || "Hardware tested and ready for escrow dispatch.",
        proposer: "You (Verified Trader)",
        timestamp: "Just now",
        proposerEmail: currentUser.email,
        sellerId: targetProduct.sellerId
      };

      trades.unshift(newTrade);
      persistData();
      closeTradeProposalModal();

      showToast(`Trade proposal #${newTrade.id} submitted for review!`);
      switchView('dashboard');
      switchDashTab('trades');
    }

    function renderTradesFeed() {
      const container = document.getElementById('tradeProposalsGrid');
      if (!container) return;

      if (trades.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-xs text-cyber-muted py-8">No community trade offers yet.</p>';
        return;
      }
      container.innerHTML = trades.map(t => {
        let badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/30";
        if (t.status === 'Accepted') badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
        if (t.status === 'Counter-Offered') badgeColor = "bg-blue-500/10 text-blue-400 border-blue-500/30";

        const cashText = t.cashDelta > 0 
          ? (t.cashDirection === 'i_pay' ? `+ Buyer adds $${t.cashDelta} cash` : `+ Requests $${t.cashDelta} cash from seller`)
          : "Straight Hardware Barter (No cash added)";

        return `
          <div class="tech-card reveal-on-scroll bg-cyber-card border border-cyber-border hover:border-cyber-red/60 rounded-xl p-5 space-y-4 font-mono transition">
            
            <div class="flex items-center justify-between text-xs pb-3 border-b border-cyber-border">
              <span class="text-cyber-muted"><i class="fa-solid fa-fingerprint text-cyber-red mr-1"></i> ${escapeHtml(t.id)}</span>
              <div class="flex items-center space-x-2">
                <span class="px-2 py-0.5 rounded text-[10px] border ${badgeColor}">${escapeHtml(t.status)}</span>
                <span class="text-[10px] text-cyber-muted">${escapeHtml(t.timestamp)}</span>
              </div>
            </div>

            <!-- Swap Visual -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-cyber-dark p-3.5 rounded-lg border border-cyber-border/80">
              <div>
                <span class="text-[10px] text-cyber-muted block">OFFERED HARDWARE</span>
                <div class="text-sm font-bold text-white">${escapeHtml(t.userDevice)}</div>
                <div class="text-xs text-cyber-red mt-0.5">Est. Value: $${t.estimatedValue} (${escapeHtml(t.condition)})</div>
              </div>
              <div class="sm:border-l sm:border-cyber-border sm:pl-3 pt-2 sm:pt-0">
                <span class="text-[10px] text-cyber-muted block">REQUESTED TECH</span>
                <div class="text-sm font-bold text-white">${escapeHtml(t.targetProduct)}</div>
                <div class="text-xs text-green-400 mt-0.5">${cashText}</div>
              </div>
            </div>

            <!-- Notes -->
            <p class="text-xs text-gray-300 font-sans italic line-clamp-2">
              "${escapeHtml(t.notes)}"
            </p>

            <!-- Actions -->
            <div class="flex items-center justify-between pt-2 border-t border-cyber-border text-xs">
              <span class="text-cyber-muted text-[11px]"><i class="fa-solid fa-user-shield text-cyber-red mr-1"></i> ${escapeHtml(t.proposer)}</span>
              <div class="space-x-2">
                ${t.status === 'Counter-Offered' ? `
                  <button onclick="acceptTradeOffer('${t.id}')" class="px-3 py-1.5 bg-green-500/20 hover:bg-green-500 text-green-400 hover:text-white border border-green-500/40 rounded transition">
                    Accept Counter
                  </button>
                ` : ''}
                <button onclick="openTradeNegotiatePrompt('${t.id}')" class="px-3 py-1.5 bg-cyber-card hover:bg-cyber-red text-white border border-cyber-border rounded transition">
                  <i class="fa-solid fa-comments mr-1"></i> Counter / Offer
                </button>
              </div>
            </div>

          </div>
        `;
      }).join('');
      setupScrollReveals(container);
    }

    function acceptTradeOffer(tradeId) {
      if (!requireSignIn(() => acceptTradeOffer(tradeId))) return;
      const trade = trades.find(t => t.id === tradeId);
      if (trade && trade.sellerId === currentUser.id) {
        trade.status = 'Accepted';
        persistData();
        renderTradesFeed();
        renderUserDashboard();
        showToast(`Trade proposal #${tradeId} accepted! Cyber Escrow instructions sent.`);
      } else {
        showToast('Only the seller can accept this trade offer.');
      }
    }

    function openTradeNegotiatePrompt(tradeId) {
      if (!requireSignIn(() => openTradeNegotiatePrompt(tradeId))) return;
      const trade = trades.find(t => t.id === tradeId);
      if (!trade) return;
      if (trade.sellerId !== currentUser.id && trade.proposerEmail !== currentUser.email) {
        showToast('Only the buyer and seller can negotiate this offer.');
        return;
      }

      const counterCash = prompt(`Enter Counter-Offer Cash Amount for Trade #${tradeId} (Current: $${trade.cashDelta}):`, trade.cashDelta + 50);
      if (counterCash !== null && !isNaN(counterCash)) {
        trade.status = "Counter-Offered";
        trade.cashDelta = parseFloat(counterCash);
        trade.notes = `Counter-offer updated: Cash adjustment revised to $${counterCash}.`;
        persistData();
        renderTradesFeed();
        renderUserDashboard();
        showToast(`Counter-offer of $${counterCash} submitted for #${tradeId}!`);
      }
    }

    /* ----------------------------------------------------
       QUICK VALUATION ESTIMATOR BAR
    ---------------------------------------------------- */
    function calculateQuickValuation() {
      const type = document.getElementById('quickDeviceType').value;
      const cond = document.getElementById('quickDeviceCondition').value;
      const resultBox = document.getElementById('quickValuationResult');

      let baseVal = 500;
      if (type === 'smartphone') baseVal = 480;
      if (type === 'laptop') baseVal = 950;
      if (type === 'console') baseVal = 320;
      if (type === 'tablet') baseVal = 400;
      if (type === 'gpu') baseVal = 700;

      let multiplier = 1.0;
      if (cond === 'mint') multiplier = 1.15;
      if (cond === 'fair') multiplier = 0.75;

      const finalVal = Math.round(baseVal * multiplier);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <div class="space-y-0.5">
          <span class="text-gray-400">Estimated Trade-In / Cash Payout:</span>
          <div class="text-lg font-bold text-cyber-red neon-text">$${finalVal} USD Instant Credit</div>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="openTradeProposalModal()" class="px-3 py-1.5 bg-cyber-red text-white rounded hover:bg-cyber-redGlow transition">
            Apply This Valuation
          </button>
        </div>
      `;
      showToast(`Estimated Trade Value: $${finalVal} USD`);
    }

    /* ----------------------------------------------------
       SELLER PORTAL: LIST NEW DEVICE
    ---------------------------------------------------- */
    function insertSampleImage() {
      const samples = [
        "https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=700&q=80",
        "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=700&q=80",
        "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=80"
      ];
      const random = samples[Math.floor(Math.random() * samples.length)];
      document.getElementById('listImageUrl').value = random;
      showToast("Sample photo inserted.");
    }

    async function handleNewDeviceListing(e) {
      e.preventDefault();
      if (!requireSignIn(() => document.getElementById('sellDeviceForm').requestSubmit())) return;

      const title = document.getElementById('listTitle').value.trim();
      const category = document.getElementById('listCategory').value;
      const condition = document.getElementById('listCondition').value;
      const price = parseFloat(document.getElementById('listPrice').value);
      const tradeValueInput = document.getElementById('listTradeValue').value;
      const tradeVal = tradeValueInput ? parseFloat(tradeValueInput) : Math.round(price * 0.8);
      const specs = document.getElementById('listSpecs').value.trim();
      let imgUrl = safeImageUrl(document.getElementById('listImageUrl').value.trim());

      if (!title || !category || !condition || !Number.isFinite(price) || price < 10 ||
          !Number.isFinite(tradeVal) || tradeVal < 0 || !specs) {
        showToast('Complete the required listing details with a valid price.');
        return;
      }

      if (!imgUrl) {
        imgUrl = "https://images.unsplash.com/photo-1550009158-9ebf69173e03?auto=format&fit=crop&w=700&q=80";
      }

      const listing = {
        seller_id: currentUser.id,
        title: title,
        category: category,
        condition: condition,
        price: price,
        trade_value: tradeVal,
        trade_eligible: document.getElementById('listAcceptTrades').checked,
        specs: specs,
        image: imgUrl,
        rating: 5.0,
        stock: 1,
        description: `Seller listing. Specifications: ${specs}.`
      };

      const { data, error } = await supabaseClient
        .from('listings')
        .insert(listing)
        .select('id')
        .single();
      if (error) {
        console.error('Unable to create listing.', error);
        showToast(`Unable to create listing: ${error.message}`);
        return;
      }

      const newProduct = {
        id: data.id,
        sellerId: currentUser.id,
        title,
        category,
        condition,
        price,
        tradeValue: tradeVal,
        tradeEligible: listing.trade_eligible,
        specs,
        image: imgUrl,
        rating: 5.0,
        stock: 1,
        description: listing.description,
        sellerName: currentUser.name
      };
      products.unshift(newProduct);
      persistData();

      document.getElementById('sellDeviceForm').reset();
      showToast(`Device "${title}" successfully listed in catalog!`);
      
      switchView('shop');
      renderCatalog();
    }

    /* ----------------------------------------------------
       USER DASHBOARD: TRADES, ORDERS, LISTINGS
    ---------------------------------------------------- */
    function switchDashTab(tabName) {
      const tabs = ['trades', 'orders', 'mylistings', 'profile'];
      if (!tabs.includes(tabName)) return;
      tabs.forEach(t => {
        document.getElementById(`dashTab-${t}`).classList.add('hidden');
        const btn = document.getElementById(`tabBtn-${t}`);
        btn.classList.remove('bg-cyber-red', 'text-white');
        btn.classList.add('text-gray-400');
        btn.setAttribute('aria-selected', 'false');
      });

      const activePanel = document.getElementById(`dashTab-${tabName}`);
      activePanel.classList.remove('hidden', 'dashboard-tab-enter');
      void activePanel.offsetWidth;
      activePanel.classList.add('dashboard-tab-enter');
      const activeBtn = document.getElementById(`tabBtn-${tabName}`);
      activeBtn.classList.add('bg-cyber-red', 'text-white');
      activeBtn.classList.remove('text-gray-400');
      activeBtn.setAttribute('aria-selected', 'true');
      if (tabName === 'profile') renderUserProfile();
      setupScrollReveals(activePanel);
    }

    function renderUserDashboard() {
      if (!currentUser) return;
      renderUserProfile();
      // 1. My Trades
      const tradesContainer = document.getElementById('userTradesList');
      const myTrades = trades.filter(trade => trade.proposerEmail === currentUser.email || trade.sellerId === currentUser.id);
      if (myTrades.length === 0) {
        tradesContainer.innerHTML = `<p class="text-xs text-cyber-muted font-mono py-8 text-center">No trade proposals initiated.</p>`;
      } else {
        tradesContainer.innerHTML = myTrades.map(t => `
          <div class="tech-card reveal-on-scroll bg-cyber-card p-4 rounded-xl border border-cyber-border flex flex-col md:flex-row justify-between items-start md:items-center gap-3 font-mono text-xs">
            <div>
              <div class="flex items-center space-x-2">
                <span class="text-cyber-red font-bold">${escapeHtml(t.id)}</span>
                <span class="text-cyber-muted">• ${t.timestamp}</span>
              </div>
              <div class="text-white font-bold text-sm mt-0.5">My ${escapeHtml(t.userDevice)} ➔ ${escapeHtml(t.targetProduct)}</div>
              <div class="text-cyber-muted text-[11px] mt-0.5">Cash adjustment: $${t.cashDelta} (${t.cashDirection})</div>
            </div>
            <div class="flex items-center space-x-3">
              <span class="px-2.5 py-1 rounded text-[11px] font-bold border ${t.status === 'Accepted' ? 'border-green-500 text-green-400' : 'border-cyber-border text-white'}">${t.status}</span>
              <button onclick="openTradeNegotiatePrompt('${t.id}')" class="px-3 py-1 bg-cyber-dark hover:bg-cyber-red rounded text-white border border-cyber-border transition">Negotiate</button>
            </div>
          </div>
        `).join('');
      }

      // 2. Orders
      const ordersContainer = document.getElementById('userOrdersList');
      const myOrders = orders.filter(order => order.buyerEmail === currentUser.email);
      if (myOrders.length === 0) {
        ordersContainer.innerHTML = `<p class="text-xs text-cyber-muted font-mono py-8 text-center">No platform orders placed yet.</p>`;
      } else {
        ordersContainer.innerHTML = myOrders.map(ord => `
          <div class="tech-card reveal-on-scroll bg-cyber-card p-4 rounded-xl border border-cyber-border space-y-3 font-mono text-xs">
            <div class="flex justify-between items-center pb-2 border-b border-cyber-border">
              <div>
                <span class="text-white font-bold">${escapeHtml(ord.id)}</span>
                <span class="text-cyber-muted text-[11px] ml-2">Date: ${ord.date}</span>
              </div>
              <span class="text-green-400 font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">${escapeHtml(ord.status)}</span>
            </div>
            <div class="flex justify-between items-center text-gray-300">
              <div>
                ${ord.items.map(i => `<div>${i.qty}x ${escapeHtml(i.title)}</div>`).join('')}
              </div>
              <div class="text-right">
                <span class="text-cyber-muted text-[10px] block">ESCROW TOTAL</span>
                <span class="text-sm font-bold text-white">$${ord.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div class="pt-2 border-t border-cyber-border/60 flex items-center justify-between text-[11px] text-cyber-muted">
              <span><i class="fa-solid fa-truck text-cyber-red mr-1"></i> Tracking: ${ord.trackingNumber}</span>
              <button onclick="showToast('Tracking coordinates synchronized with CyberCourier node.')" class="text-cyber-red hover:underline">Track Live</button>
            </div>
          </div>
        `).join('');
      }

      // 3. User Listings
      const userListingsContainer = document.getElementById('userListingsGrid');
      const myItems = products.filter(product => product.sellerId === currentUser.id);
      if (myItems.length === 0) {
        userListingsContainer.innerHTML = '<p class="col-span-full text-xs text-cyber-muted font-mono py-8 text-center">You have not listed any electronics yet.</p>';
        updateDashboardCounts();
        return;
      }
      userListingsContainer.innerHTML = myItems.map(p => `
        <div class="tech-card reveal-on-scroll bg-cyber-card p-3 rounded-xl border border-cyber-border font-mono text-xs space-y-2">
          <img src="${escapeHtml(p.image)}" class="h-28 w-full object-cover rounded bg-cyber-dark">
          <div class="font-bold text-white truncate">${escapeHtml(p.title)}</div>
          <div class="flex justify-between text-cyber-muted text-[11px]">
            <span>Price: $${p.price}</span>
            <span>${escapeHtml(p.condition)}</span>
          </div>
          <button onclick="removeListing(${jsArgument(p.id)})" class="w-full py-1 text-cyber-red bg-cyber-dark border border-cyber-border rounded hover:bg-cyber-red hover:text-white transition">
            Remove Listing
          </button>
        </div>
      `).join('');
      setupScrollReveals(userListingsContainer);

      updateDashboardCounts();
    }

    function renderUserProfile() {
      if (!currentUser) return;
      const myTrades = trades.filter(trade => trade.proposerEmail === currentUser.email || trade.sellerId === currentUser.id);
      const myOrders = orders.filter(order => order.buyerEmail === currentUser.email);
      const myListings = products.filter(product => product.sellerId === currentUser.id);
      document.getElementById('profileName').textContent = currentUser.name || 'Member';
      document.getElementById('profileEmail').textContent = currentUser.email;
      document.getElementById('profileActivity').textContent =
        `${myListings.length} listings | ${myTrades.length} trade offers | ${myOrders.length} orders`;
    }

    function setupScrollReveals(root = document) {
      const elements = root.querySelectorAll('.reveal-on-scroll:not(.is-visible)');
      if (!elements.length) return;
      if (!('IntersectionObserver' in window)) {
        elements.forEach(element => element.classList.add('is-visible'));
        return;
      }

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12 });
      elements.forEach(element => observer.observe(element));
    }

    async function removeListing(prodId) {
      if (!requireSignIn(() => removeListing(prodId))) return;
      const listing = products.find(product => product.id === prodId);
      if (!listing || listing.sellerId !== currentUser.id) {
        showToast('You can only remove your own listings.');
        return;
      }
      const { error } = await supabaseClient
        .from('listings')
        .delete()
        .eq('id', prodId)
        .eq('seller_id', currentUser.id);
      if (error) {
        console.error('Unable to remove listing.', error);
        showToast(`Unable to remove listing: ${error.message}`);
        return;
      }
      products = products.filter(p => p.id !== prodId);
      renderCatalog();
      renderUserDashboard();
      showToast('Listing removed from store.');
    }

    function updateDashboardCounts() {
      const myTrades = currentUser
        ? trades.filter(trade => trade.proposerEmail === currentUser.email || trade.sellerId === currentUser.id)
        : [];
      const myOrders = currentUser ? orders.filter(order => order.buyerEmail === currentUser.email) : [];
      const myListings = currentUser ? products.filter(product => product.sellerId === currentUser.id) : [];
      document.getElementById('dashTradeCount').innerText = myTrades.length;
      document.getElementById('dashOrderCount').innerText = myOrders.length;
      document.getElementById('dashListingCount').innerText = myListings.length;
      document.getElementById('activeTradesBadge').innerText = myTrades.length;
    }

    /* ----------------------------------------------------
       TOAST NOTIFICATION COMPONENT
    ---------------------------------------------------- */
    function showToast(message) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = "bg-cyber-card border border-cyber-red text-white px-4 py-3 rounded-lg shadow-neon text-xs font-mono flex items-center space-x-3 pointer-events-auto transition transform duration-300 translate-y-2";
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-circle-check text-cyber-red text-sm';
      const text = document.createElement('span');
      text.textContent = message;
      toast.append(icon, text);
      container.appendChild(toast);

      setTimeout(() => {
        toast.classList.remove('translate-y-2');
      }, 10);

      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    document.addEventListener('click', event => {
      const button = event.target.closest('button:not(:disabled)');
      if (!button) return;

      button.classList.remove('button-pressed');
      void button.offsetWidth;
      button.classList.add('button-pressed');
    });
  