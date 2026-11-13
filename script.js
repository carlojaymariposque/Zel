    /* ----------------------------------------------------
       APPLICATION STATE
    ---------------------------------------------------- */
    let products = [];
    let userListings = [];
    let trades = (JSON.parse(localStorage.getItem('cr_trades')) || []).filter(trade => trade.proposerEmail);
    let orders = [];
    let legacyOrders = (JSON.parse(localStorage.getItem('cr_orders')) || []).filter(order => order.buyerEmail);
    let currentUser = null;
    let supabaseClient = null;
    let listingsRefreshPromise = null;
    let listingsRealtimeChannel = null;
    let listingsRealtimeWarningShown = false;
    let scrollRevealObserver = null;
    let cart = [];
    let selectedProfileAvatar = null;
    let selectedListingImages = [];
    let pageLoaderTimer = null;
    let pendingAuthAction = null;
    let authMode = 'login';
    let promoDiscountPercent = 0;
    let activePromoCode = '';
    let activeFilterCategory = "All";
    let activeSearchTerm = "";
    let activeMaxPrice = 200000;
    let selectedConditions = [];
    let tradeOnlyFilter = false;
    let activeProductGalleryIndex = 0;
    let activeProductGalleryProductId = null;
    let adminData = { users: [], listings: [], trades: [], orders: [] };

    function formatCurrency(amount, minimumFractionDigits = 0) {
      return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits,
        maximumFractionDigits: 2
      }).format(Number(amount) || 0);
    }

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

    function cartStorageKey(userId) {
      return `cr_cart_${userId}`;
    }

    function loadCartForUser(userId) {
      try {
        const savedCart = JSON.parse(localStorage.getItem(cartStorageKey(userId)) || '[]');
        if (!Array.isArray(savedCart)) throw new Error('Saved cart data is not a list.');
        cart = savedCart.filter(item =>
          item && typeof item.id === 'string' &&
          Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
          Number.isInteger(Number(item.qty)) && Number(item.qty) > 0
        ).map(item => ({ ...item, price: Number(item.price), qty: Number(item.qty) }));
      } catch (error) {
        console.error('Unable to restore the saved cart.', error);
        cart = [];
        localStorage.removeItem(cartStorageKey(userId));
        showToast('Saved cart data could not be restored and has been cleared.');
      }
    }

    function mapOrderRow(order) {
      return {
        id: order.order_number,
        databaseId: order.id,
        date: new Date(order.created_at).toLocaleDateString(),
        items: (order.order_items || []).map(item => ({
          id: item.listing_id || item.title_snapshot,
          title: item.title_snapshot,
          price: Number(item.unit_price),
          qty: item.quantity,
          image: item.image_snapshot || ''
        })),
        total: Number(order.total),
        status: order.status,
        trackingNumber: order.tracking_number || 'Not assigned',
        buyerEmail: order.buyer_email,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status
      };
    }

    async function loadUserOrders() {
      if (!currentUser || !supabaseClient) {
        orders = [];
        return;
      }
      const { data, error } = await supabaseClient
        .from('orders')
        .select('id, order_number, buyer_email, total, status, tracking_number, payment_method, payment_status, created_at, order_items(id, listing_id, title_snapshot, unit_price, quantity, image_snapshot)')
        .eq('buyer_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      orders = (data || []).map(mapOrderRow);
      updateDashboardCounts();
      if (document.getElementById('view-dashboard') && !document.getElementById('view-dashboard').classList.contains('hidden')) {
        renderUserDashboard();
      }
    }

    function saveCartForCurrentUser() {
      if (!currentUser) return;
      try {
        localStorage.setItem(cartStorageKey(currentUser.id), JSON.stringify(cart));
      } catch (error) {
        console.error('Unable to save the cart.', error);
        showToast('Unable to save your cart on this device.');
      }
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
      saveCartForCurrentUser();
      updateCartBadges();
      updateDashboardCounts();
      renderHomeDashboard();
    }

    function hidePageLoader() {
      const loader = document.getElementById('pageLoader');
      if (!loader) return;
      loader.classList.add('page-loader-hidden');
      loader.classList.remove('page-loader-interaction');
      if (pageLoaderTimer) window.clearTimeout(pageLoaderTimer);
      pageLoaderTimer = null;
    }

    function showInteractionLoader() {
      const loader = document.getElementById('pageLoader');
      if (!loader) return;
      loader.classList.remove('page-loader-hidden');
      loader.classList.add('page-loader-interaction');
      if (pageLoaderTimer) window.clearTimeout(pageLoaderTimer);
      pageLoaderTimer = window.setTimeout(hidePageLoader, 420);
    }

    function setupMainFireBackground() {
      const video = document.querySelector('.main-fire-video');
      if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const playVideo = () => {
        if (!video.dataset.loaded) {
          video.src = video.dataset.src;
          video.dataset.loaded = 'true';
          video.load();
        }
        video.play().catch(error => {
          console.warn('The background video could not start playback.', error);
        });
      };

      if (!('IntersectionObserver' in window)) {
        playVideo();
        return;
      }

      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          playVideo();
        } else {
          video.pause();
        }
      }, { rootMargin: '100px' });
      observer.observe(video);
    }

    /* ----------------------------------------------------
       INITIALIZATION
    ---------------------------------------------------- */
    document.addEventListener('DOMContentLoaded', async () => {
      setupMainFireBackground();
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
        if (data.session) await hydrateCurrentUser(data.session.user, getViewFromLocation() === 'admin');
        await loadListings();
        if (currentUser) {
          try {
            await loadUserListings();
          } catch (error) {
            console.error('Unable to load the member listings.', error);
            showToast(`Your listings are unavailable: ${error.message || 'Check the Supabase setup.'}`);
          }
          try {
            await loadUserOrders();
          } catch (error) {
            console.error('Unable to load the member orders.', error);
            showToast(`Your orders are unavailable: ${error.message || 'Check the Supabase setup.'}`);
          }
        }
        subscribeToListingChanges();
        window.addEventListener('focus', refreshListings);
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) refreshListings();
        });
      } catch (error) {
        console.error('Unable to initialize the Supabase marketplace.', error);
        showToast(`Marketplace connection failed: ${error.message || 'Check Supabase configuration.'}`);
      } finally {
        updateAuthButton();
        renderCatalog();
        renderCart();
        populateTargetDeviceDropdown();
        updateDashboardCounts();
        renderHomeDashboard();
        switchView(getViewFromLocation(), false);
        pageLoaderTimer = window.setTimeout(hidePageLoader, 900);
      }
    });

    /* ----------------------------------------------------
       NAVIGATION ROUTING
    ---------------------------------------------------- */
    function getViewFromLocation() {
      const route = window.location.hash.slice(1);
      const routes = {
        home: 'home',
        store: 'shop',
        trades: 'tradeHub',
        sell: 'sellPortal',
        account: 'dashboard',
        admin: 'admin'
      };
      return routes[route] || 'home';
    }

    function switchView(viewName, updateHistory = true) {
      if ((viewName === 'sellPortal' || viewName === 'dashboard') && !requireSignIn(() => switchView(viewName))) return;
      if (viewName === 'admin' && (!currentUser || !currentUser.isAdmin)) {
        if (updateHistory && window.location.hash !== '#admin') window.history.pushState(null, '', '#admin');
        openAdminLogin();
        return;
      }
      const views = ['home', 'shop', 'tradeHub', 'sellPortal', 'dashboard', 'admin'];
      views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        const navBtn = document.getElementById(v === 'home' ? 'nav-home' : `nav-${v}`);
        if (el) el.classList.add('hidden');
        if (navBtn) {
          navBtn.classList.remove('text-cyber-red', 'bg-cyber-red/10', 'border-cyber-red/30');
          navBtn.classList.add('text-gray-300');
        }
      });

      const target = document.getElementById(`view-${viewName}`);
      if (target) {
        target.classList.remove('hidden', 'view-transition-in');
        void target.offsetWidth;
        target.classList.add('view-transition-in');
      }
      const selectedNav = document.getElementById(viewName === 'home' ? 'nav-home' : `nav-${viewName}`);
      if (selectedNav) {
        selectedNav.classList.add('text-cyber-red', 'bg-cyber-red/10', 'border-cyber-red/30');
        selectedNav.classList.remove('text-gray-300');
      }

      if (viewName === 'dashboard') {
        renderUserDashboard();
        target.classList.remove('dashboard-boot');
        void target.offsetWidth;
        target.classList.add('dashboard-boot');
      } else if (viewName === 'admin') {
        loadAdminDashboard();
      } else if (viewName === 'tradeHub') {
        renderTradesFeed();
      }
      if (viewName === 'home') renderHomeDashboard();
      if (target) setupScrollReveals(target);
      if (updateHistory) {
        const route = { home: 'home', shop: 'store', tradeHub: 'trades', sellPortal: 'sell', dashboard: 'account', admin: 'admin' }[viewName];
        if (route && window.location.hash !== `#${route}`) {
          window.history.pushState(null, '', `#${route}`);
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderHomeDashboard() {
      const greeting = document.getElementById('homeGreetingName');
      const storeCount = document.getElementById('homeStoreCount');
      const tradeCount = document.getElementById('homeTradeCount');
      const accountStatus = document.getElementById('homeAccountStatus');
      if (!greeting || !storeCount || !tradeCount || !accountStatus) return;

      const greetingName = currentUser && currentUser.name ? `, ${currentUser.name}` : '';
      greeting.textContent = greetingName;
      if (greetingName) greeting.dataset.text = greetingName;
      else delete greeting.dataset.text;
      storeCount.textContent = String(products.length);
      tradeCount.textContent = String(currentUser
        ? trades.filter(trade => trade.proposerEmail === currentUser.email || trade.sellerId === currentUser.id).length
        : 0);
      accountStatus.textContent = currentUser ? 'Signed in' : 'Guest';
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
      renderHomeDashboard();
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
      const authError = document.getElementById('authErrorMessage');
      authError.textContent = '';
      authError.classList.add('hidden');
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
      document.getElementById('authPassword').minLength = isRegistration ? 8 : 1;
      document.getElementById('authConfirmPassword').minLength = isRegistration ? 8 : 0;
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
      document.getElementById('authErrorMessage').classList.add('hidden');
      pendingAuthAction = null;
    }

    function requireSignIn(action) {
      if (currentUser) return true;
      pendingAuthAction = action || null;
      openAuthModal();
      return false;
    }

    function openAdminLogin() {
      if (currentUser && currentUser.isAdmin) {
        switchView('admin');
        return;
      }
      const modal = document.getElementById('adminAuthModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('adminAuthEmail').focus();
    }

    function closeAdminLogin() {
      const modal = document.getElementById('adminAuthModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.getElementById('adminAuthForm').reset();
      document.getElementById('adminAuthErrorMessage').classList.add('hidden');
    }

    async function handleAdminSignIn(event) {
      event.preventDefault();
      if (!supabaseClient) {
        showAdminLoginError('The account service is unavailable. Please try again later.');
        return;
      }

      const button = document.getElementById('adminAuthSubmitButton');
      const email = document.getElementById('adminAuthEmail').value.trim().toLowerCase();
      button.disabled = true;
      button.textContent = 'Verifying admin access...';
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email,
          password: document.getElementById('adminAuthPassword').value
        });
        if (error) throw error;
        await hydrateCurrentUser(data.user, true);
        if (!currentUser || !currentUser.isAdmin) {
          const { error: signOutError } = await supabaseClient.auth.signOut();
          if (signOutError) throw signOutError;
          const roleError = currentUser && currentUser.adminRoleError;
          currentUser = null;
          updateAuthButton();
          throw new Error(roleError
            ? `Unable to verify admin access (${roleError}). Run the latest supabase-setup.sql and grant an admin role.`
            : 'This account is not authorized for admin access. Ask a project owner to grant the admin role.');
        }

        updateAuthButton();
        closeAdminLogin();
        switchView('admin');
        showToast(`Admin session started for ${currentUser.email}.`);
      } catch (error) {
        console.error('Admin authentication failed.', error);
        showAdminLoginError(error.message || 'Unable to verify admin access.');
      } finally {
        button.disabled = false;
        button.textContent = 'Sign in to admin';
      }
    }

    function showAdminLoginError(message) {
      const errorElement = document.getElementById('adminAuthErrorMessage');
      errorElement.textContent = message;
      errorElement.classList.remove('hidden');
    }

    function switchAdminTab(tabName) {
      if (!currentUser || !currentUser.isAdmin) return;
      const tabs = ['users', 'listings', 'trades', 'orders'];
      if (!tabs.includes(tabName)) return;
      tabs.forEach(tab => {
        document.getElementById(`adminTab-${tab}`).classList.toggle('hidden', tab !== tabName);
        const button = document.getElementById(`adminTabBtn-${tab}`);
        button.setAttribute('aria-selected', String(tab === tabName));
        button.classList.toggle('bg-cyber-red', tab === tabName);
        button.classList.toggle('text-white', tab === tabName);
        button.classList.toggle('border', tab !== tabName);
        button.classList.toggle('border-cyber-border', tab !== tabName);
        button.classList.toggle('text-gray-300', tab !== tabName);
      });
    }

    async function loadAdminDashboard() {
      if (!currentUser || !currentUser.isAdmin || !supabaseClient) return;
      const errorElement = document.getElementById('adminErrorMessage');
      errorElement.classList.add('hidden');
      try {
        const [usersResult, listingsResult, tradesResult, ordersResult] = await Promise.all([
          supabaseClient.from('profiles').select('id, display_name, created_at').order('created_at', { ascending: false }),
          supabaseClient.from('listings').select('id, seller_id, title, category, price, stock, is_active, approval_status, created_at').order('created_at', { ascending: false }),
          supabaseClient.from('trade_offers').select('id, proposer_id, seller_id, target_listing_title, offered_device_name, status, created_at').order('created_at', { ascending: false }),
          supabaseClient.from('orders').select('id, order_number, buyer_email, shipping_name, shipping_email, shipping_address, city, province, postal_code, payment_method, payment_status, subtotal, discount, total, status, tracking_number, created_at, order_items(id, title_snapshot, unit_price, quantity)').order('created_at', { ascending: false })
        ]);
        if (usersResult.error) throw usersResult.error;
        if (listingsResult.error) throw listingsResult.error;
        if (tradesResult.error) throw tradesResult.error;
        if (ordersResult.error) throw ordersResult.error;
        adminData = {
          users: usersResult.data || [],
          listings: listingsResult.data || [],
          trades: tradesResult.data || [],
          orders: ordersResult.data || []
        };
        renderAdminDashboard();
      } catch (error) {
        console.error('Unable to load admin data.', error);
        errorElement.textContent = `Unable to load admin data: ${error.message || 'Check the admin database setup and permissions.'}`;
        errorElement.classList.remove('hidden');
      }
    }

    function renderAdminDashboard() {
      document.getElementById('adminUserCount').textContent = String(adminData.users.length);
      document.getElementById('adminListingCount').textContent = String(adminData.listings.length);
      document.getElementById('adminPendingListingCount').textContent =
        `${adminData.listings.filter(listing => listing.approval_status === 'pending').length} pending approval`;
      document.getElementById('adminTradeCount').textContent = String(adminData.trades.length);
      document.getElementById('adminOrderCount').textContent = String(adminData.orders.length);

      document.getElementById('adminUsersList').innerHTML = adminData.users.length
        ? adminData.users.map(user => `
          <div class="flex flex-col gap-1 border-b border-cyber-border py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span class="font-bold text-white">${escapeHtml(user.display_name || 'ZEL member')}</span>
            <span class="break-all font-mono text-[10px] text-cyber-muted">${escapeHtml(user.id)}</span>
            <span class="text-cyber-muted">${new Date(user.created_at).toLocaleDateString()}</span>
          </div>
        `).join('')
        : '<p class="py-4 text-xs text-cyber-muted">No member profiles found.</p>';

      const categories = [...new Set(adminData.listings.map(listing => listing.category).filter(Boolean))].sort();
      document.getElementById('adminCategoriesList').innerHTML = categories.length
        ? categories.map(category => `<span class="rounded-full border border-cyber-border px-3 py-1 text-[11px] text-gray-300">${escapeHtml(category)}</span>`).join('')
        : '<p class="text-xs text-cyber-muted">No categories in use.</p>';

      const sortedListings = [...adminData.listings].sort((a, b) =>
        (a.approval_status === 'pending' ? 0 : 1) - (b.approval_status === 'pending' ? 0 : 1)
      );
      document.getElementById('adminListingsList').innerHTML = sortedListings.length
        ? sortedListings.map(listing => `
          <div class="flex flex-col gap-3 border-b border-cyber-border py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <p class="break-words font-bold text-white">${escapeHtml(listing.title)}</p>
              <p class="mt-1 text-[10px] text-cyber-muted">${escapeHtml(listing.category)} · ${formatCurrency(listing.price)} · Stock ${Number(listing.stock)}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="${listing.approval_status === 'approved' && listing.is_active ? 'text-emerald-400' : 'text-amber-400'}">${escapeHtml(listing.approval_status)}${listing.approval_status === 'approved' ? (listing.is_active ? ' · Active' : ' · Hidden') : ''}</span>
              ${listing.approval_status !== 'approved'
                ? `<button type="button" onclick="reviewAdminListing(${jsArgument(listing.id)}, 'approved')" class="rounded border border-emerald-500/40 px-3 py-1.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20">Approve</button>`
                : `<button type="button" onclick="setAdminListingActive(${jsArgument(listing.id)}, ${!listing.is_active})" class="rounded border border-cyber-border px-3 py-1.5 text-[10px] text-white hover:border-cyber-red">${listing.is_active ? 'Hide listing' : 'Restore listing'}</button>`}
              ${listing.approval_status === 'pending'
                ? `<button type="button" onclick="reviewAdminListing(${jsArgument(listing.id)}, 'rejected')" class="rounded border border-red-500/40 px-3 py-1.5 text-[10px] text-red-300 hover:bg-red-500/20">Reject</button>`
                : ''}
            </div>
          </div>
        `).join('')
        : '<p class="py-4 text-xs text-cyber-muted">No product listings found.</p>';

      document.getElementById('adminTradesList').innerHTML = adminData.trades.length
        ? adminData.trades.map(trade => `
          <div class="flex flex-col gap-3 border-b border-cyber-border py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <p class="break-words font-bold text-white">${escapeHtml(trade.offered_device_name)} for ${escapeHtml(trade.target_listing_title)}</p>
              <p class="mt-1 break-all text-[10px] text-cyber-muted">Offer ${escapeHtml(trade.id)} · Proposer ${escapeHtml(trade.proposer_id)} · ${new Date(trade.created_at).toLocaleDateString()}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="text-cyber-muted">${escapeHtml(trade.status)}</span>
              ${['pending', 'countered'].includes(trade.status)
                ? `<button type="button" onclick="declineAdminTrade(${jsArgument(trade.id)})" class="rounded border border-cyber-border px-3 py-1.5 text-[10px] text-white hover:border-cyber-red">Decline offer</button>`
                : ''}
            </div>
          </div>
        `).join('')
        : '<p class="py-4 text-xs text-cyber-muted">No database trade offers found.</p>';

      document.getElementById('adminOrdersList').innerHTML = adminData.orders.length
        ? adminData.orders.map(order => `
          <article class="space-y-3 border-b border-cyber-border py-4 text-xs">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="font-mono font-bold text-white">${escapeHtml(order.order_number)}</p>
                <p class="mt-1 text-[10px] text-cyber-muted">${new Date(order.created_at).toLocaleString()}</p>
              </div>
              <div class="text-left sm:text-right">
                <p class="font-bold text-white">${formatCurrency(order.total, 2)}</p>
                <p class="mt-1 text-[10px] text-cyber-muted">${escapeHtml(order.status)} · ${escapeHtml(order.payment_method.replace(/_/g, ' '))} (${escapeHtml(order.payment_status.replace(/_/g, ' '))})</p>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="rounded-lg bg-cyber-dark p-3">
                <p class="mb-1 text-[10px] uppercase tracking-wider text-cyber-red">Customer</p>
                <p class="text-white">${escapeHtml(order.shipping_name)} · ${escapeHtml(order.shipping_email)}</p>
                <p class="mt-1 text-cyber-muted">${escapeHtml(order.buyer_email)}</p>
              </div>
              <div class="rounded-lg bg-cyber-dark p-3">
                <p class="mb-1 text-[10px] uppercase tracking-wider text-cyber-red">Ship to</p>
                <p class="text-gray-200">${escapeHtml(order.shipping_address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.province)} ${escapeHtml(order.postal_code)}</p>
              </div>
            </div>
            <ul class="space-y-1 text-[11px] text-gray-300">
              ${(order.order_items || []).map(item => `
                <li class="flex justify-between gap-3">
                  <span>${Number(item.quantity)} × ${escapeHtml(item.title_snapshot)}</span>
                  <span class="shrink-0">${formatCurrency(Number(item.unit_price) * Number(item.quantity), 2)}</span>
                </li>
              `).join('')}
            </ul>
          </article>
        `).join('')
        : '<p class="py-4 text-xs text-cyber-muted">No orders have been placed yet.</p>';
    }

    async function setAdminListingActive(listingId, isActive) {
      if (!currentUser || !currentUser.isAdmin) {
        showToast('Admin access is required to manage listings.');
        return;
      }
      try {
        const { data, error } = await supabaseClient
          .from('listings')
          .update({ is_active: isActive })
          .eq('id', listingId)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This listing no longer exists.');
        await loadAdminDashboard();
        await loadListings();
        showToast(isActive ? 'Listing restored to the store.' : 'Listing hidden from the store.');
      } catch (error) {
        console.error('Unable to update listing visibility.', error);
        showToast(`Unable to update listing: ${error.message || 'Please try again.'}`);
      }
    }

    async function reviewAdminListing(listingId, approvalStatus) {
      if (!currentUser || !currentUser.isAdmin || !['approved', 'rejected'].includes(approvalStatus)) {
        showToast('Admin access is required to review listings.');
        return;
      }
      try {
        const { data, error } = await supabaseClient
          .from('listings')
          .update({
            approval_status: approvalStatus,
            is_active: approvalStatus === 'approved'
          })
          .eq('id', listingId)
          .in('approval_status', approvalStatus === 'approved' ? ['pending', 'rejected'] : ['pending'])
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This listing has already been reviewed.');
        await Promise.all([loadAdminDashboard(), loadListings()]);
        showToast(approvalStatus === 'approved' ? 'Listing approved and published.' : 'Listing rejected.');
      } catch (error) {
        console.error('Unable to review listing.', error);
        showToast(`Unable to review listing: ${error.message || 'Please try again.'}`);
      }
    }

    async function declineAdminTrade(tradeId) {
      if (!currentUser || !currentUser.isAdmin) {
        showToast('Admin access is required to manage trade offers.');
        return;
      }
      try {
        const { data, error } = await supabaseClient
          .from('trade_offers')
          .update({ status: 'declined' })
          .eq('id', tradeId)
          .in('status', ['pending', 'countered'])
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This offer is no longer open.');
        await loadAdminDashboard();
        showToast('Trade offer declined.');
      } catch (error) {
        console.error('Unable to update trade offer.', error);
        showToast(`Unable to update trade offer: ${error.message || 'Please try again.'}`);
      }
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
        try {
          await loadUserListings();
        } catch (error) {
          console.error('Unable to load the member listings.', error);
          showToast(`Your listings are unavailable: ${error.message || 'Check the Supabase setup.'}`);
        }
        try {
          await loadUserOrders();
        } catch (error) {
          console.error('Unable to load the member orders.', error);
          showToast(`Your orders are unavailable: ${error.message || 'Check the Supabase setup.'}`);
        }
        document.getElementById('authForm').reset();
        setAuthMode('login');
        updateAuthButton();
        renderCatalog();
        renderCart();
        renderTradesFeed();
        updateDashboardCounts();
        renderHomeDashboard();
        const action = pendingAuthAction;
        pendingAuthAction = null;
        closeAuthModal();
        showToast(isRegistration ? `Welcome, ${currentUser.name}!` : `Signed in as ${currentUser.name || email}.`);
        if (action) action();
      } catch (error) {
        console.error('Authentication failed.', error);
        const message = error.message || '';
        const invalidLogin = !isRegistration && (
          error.code === 'invalid_credentials' ||
          /invalid login credentials|invalid email or password|user not found/i.test(message)
        );
        if (invalidLogin) {
          const message = 'Email or password is incorrect. Check your credentials and try again.';
          const authError = document.getElementById('authErrorMessage');
          authError.textContent = message;
          authError.classList.remove('hidden');
          showToast(message);
        } else {
          const detail = /email not confirmed/i.test(message)
            ? 'Confirm your email using the link we sent, then try logging in again.'
            : /too many requests|rate limit/i.test(message)
              ? 'Too many attempts. Wait a few minutes before trying again.'
              : message || 'Please try again.';
          const authError = document.getElementById('authErrorMessage');
          authError.textContent = detail;
          authError.classList.remove('hidden');
          showToast(`Unable to ${isRegistration ? 'create account' : 'log in'}: ${detail}`);
        }
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = authMode === 'register' ? 'Create account' : 'Log in';
      }
    }

    async function hydrateCurrentUser(user, verifyAdmin = false) {
      if (!user) {
        currentUser = null;
        userListings = [];
        orders = [];
        return;
      }
      const metadataName = user.user_metadata && user.user_metadata.display_name;
      currentUser = {
        id: user.id,
        email: user.email,
        name: metadataName || user.email.split('@')[0],
        avatarUrl: '',
        phone: '',
        location: '',
        isAdmin: false,
        adminRoleError: ''
      };
      userListings = [];
      loadCartForUser(user.id);
      if (verifyAdmin) {
        const { data: adminRole, error: adminRoleError } = await supabaseClient
          .from('admin_users')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (adminRoleError) {
          console.error('Unable to verify admin privileges.', adminRoleError);
          currentUser.adminRoleError = adminRoleError.message;
        } else {
          currentUser.isAdmin = Boolean(adminRole);
        }
      }
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.error('Unable to load the member profile.', error);
        showToast(`Profile details are unavailable: ${error.message}`);
        return;
      }
      if (data) {
        if (data.display_name) currentUser.name = data.display_name;
        currentUser.avatarUrl = data.avatar_url || '';
      }
      const { data: privateData, error: privateError } = await supabaseClient
        .from('member_private_profiles')
        .select('phone, location')
        .eq('id', user.id)
        .maybeSingle();
      if (privateError) {
        console.error('Unable to load private member profile details.', privateError);
        showToast(`Private profile details are unavailable: ${privateError.message}`);
        return;
      }
      if (privateData) {
        currentUser.phone = privateData.phone || '';
        currentUser.location = privateData.location || '';
      }
    }

    const listingColumns = 'id, seller_id, title, category, condition, price, trade_value, trade_eligible, specs, image, images, rating, stock, description, approval_status, is_active, seller:profiles(display_name)';

    function mapListingRow(listing) {
      const image = safeImageUrl(listing.image);
      const images = Array.isArray(listing.images)
        ? listing.images.map(safeImageUrl).filter(Boolean)
        : [];
      if (image && !images.includes(image)) images.unshift(image);
      return {
        id: listing.id,
        sellerId: listing.seller_id,
        title: listing.title,
        category: listing.category,
        condition: listing.condition,
        price: Number(listing.price),
        tradeValue: Number(listing.trade_value),
        tradeEligible: listing.trade_eligible,
        specs: listing.specs,
        image: images[0] || image,
        images,
        rating: Number(listing.rating),
        stock: listing.stock,
        description: listing.description,
        approvalStatus: listing.approval_status,
        isActive: listing.is_active,
        sellerName: listing.seller && listing.seller.display_name
      };
    }

    async function loadListings() {
      let { data, error } = await supabaseClient
        .from('listings')
        .select(listingColumns)
        .eq('is_active', true)
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false });
      if (error && error.code === '42703' && error.message.includes('listings.images')) {
        console.warn('Product photo galleries require the latest supabase-setup.sql configuration.');
        ({ data, error } = await supabaseClient
          .from('listings')
          .select(listingColumns.replace(', images', ''))
          .eq('is_active', true)
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false }));
      }
      if (error) throw error;
      products = (data || []).map(mapListingRow);
      renderCatalog();
      populateTargetDeviceDropdown();
      updateDashboardCounts();
    }

    async function loadUserListings() {
      if (!currentUser || !supabaseClient) {
        userListings = [];
        return;
      }
      let { data, error } = await supabaseClient
        .from('listings')
        .select(listingColumns)
        .eq('seller_id', currentUser.id)
        .order('created_at', { ascending: false });
      if (error && error.code === '42703' && error.message.includes('listings.images')) {
        ({ data, error } = await supabaseClient
          .from('listings')
          .select(listingColumns.replace(', images', ''))
          .eq('seller_id', currentUser.id)
          .order('created_at', { ascending: false }));
      }
      if (error) throw error;
      userListings = (data || []).map(mapListingRow);
      updateDashboardCounts();
      if (document.getElementById('view-dashboard') && !document.getElementById('view-dashboard').classList.contains('hidden')) {
        renderUserDashboard();
      }
    }

    function subscribeToListingChanges() {
      if (!supabaseClient || listingsRealtimeChannel) return;
      listingsRealtimeChannel = supabaseClient
        .channel('public-listings')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'listings'
        }, refreshListings)
        .subscribe((status, error) => {
          if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return;
          console.error('Live listing updates are unavailable.', error || status);
          if (listingsRealtimeWarningShown) return;
          listingsRealtimeWarningShown = true;
          showToast('Live listing updates are unavailable. Refresh the store to see new devices.');
        });
    }

    async function refreshListings() {
      if (!supabaseClient) return;
      if (listingsRefreshPromise) return listingsRefreshPromise;
      listingsRefreshPromise = loadListings()
        .then(() => currentUser ? loadUserListings() : null)
        .catch(error => {
          console.error('Unable to refresh marketplace listings.', error);
          showToast(`Unable to refresh listings: ${error.message || 'Please try again.'}`);
        })
        .finally(() => {
          listingsRefreshPromise = null;
        });
      return listingsRefreshPromise;
    }

    async function logOut() {
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        console.error('Logout failed.', error);
        showToast(`Unable to log out: ${error.message}`);
        return;
      }
      saveCartForCurrentUser();
      currentUser = null;
      userListings = [];
      orders = [];
      cart = [];
      persistData();
      renderCart();
      updateAuthButton();
      renderCatalog();
      renderTradesFeed();
      renderHomeDashboard();
      switchView('home');
      showToast('You have been logged out.');
    }

    function scrollToCatalog() {
      switchView('shop');
      window.requestAnimationFrame(() => {
        document.getElementById('catalogSection').scrollIntoView({ behavior: 'smooth' });
      });
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
      document.getElementById('priceLabel').innerText = formatCurrency(activeMaxPrice);
      applyFilters();
    }

    function resetFilters() {
      activeFilterCategory = "All";
      activeSearchTerm = "";
      activeMaxPrice = 200000;
      document.getElementById('priceRange').value = 200000;
      document.getElementById('priceLabel').innerText = formatCurrency(activeMaxPrice);
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
              <button type="button" onclick="openProductModal(${jsArgument(p.id)})" aria-label="Quick view ${escapeHtml(p.title)}" class="quick-view-button absolute inset-0 w-full h-full text-left">
                <img src="${escapeHtml(p.image)}" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                <span class="quick-view-label absolute bottom-2 right-2 rounded bg-black/75 px-2.5 py-1 text-[10px] font-mono font-bold uppercase text-white opacity-0 transition group-hover:opacity-100">Quick View</span>
              </button>
              
              ${p.images && p.images.length > 1 ? `
                <span class="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[10px] font-mono text-white">
                  <i class="fa-regular fa-images mr-1"></i>${p.images.length} photos
                </span>
              ` : ''}

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
                    <span class="text-lg font-mono font-bold text-white">${formatCurrency(p.price)}</span>
                  </div>
                  <div class="text-right">
                    <span class="text-xs text-cyber-red block text-[10px] font-mono">EST. TRADE VALUE</span>
                    <span class="text-xs font-mono font-bold text-cyber-red">~${formatCurrency(p.tradeValue)}</span>
                  </div>
                </div>
              </div>

              <!-- Action Buttons -->
              <div class="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                <button ${isOwnListing ? 'disabled' : ''} onclick="addToCart(${jsArgument(p.id)})" class="w-full py-2 bg-cyber-card hover:bg-cyber-red text-white border border-cyber-border hover:border-cyber-red rounded font-semibold transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                  <i class="fa-solid fa-cart-plus mr-1.5 text-xs"></i> ${isOwnListing ? 'Your Listing' : 'Add to Cart'}
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
      const images = item.images && item.images.length ? item.images : [item.image];
      activeProductGalleryIndex = 0;
      activeProductGalleryProductId = item.id;

      content.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-3">
            <div class="relative h-64 rounded-xl bg-cyber-dark overflow-hidden border border-cyber-border">
              <img id="productGalleryMainImage" src="${escapeHtml(images[0])}" alt="${escapeHtml(item.title)} photo 1 of ${images.length}" class="w-full h-full object-contain">
              ${images.length > 1 ? `
                <button type="button" onclick="changeProductGalleryImage(-1)" aria-label="Previous product photo" class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/75 px-3 py-2 text-white hover:bg-cyber-red">
                  <i class="fa-solid fa-chevron-left"></i>
                </button>
                <button type="button" onclick="changeProductGalleryImage(1)" aria-label="Next product photo" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/75 px-3 py-2 text-white hover:bg-cyber-red">
                  <i class="fa-solid fa-chevron-right"></i>
                </button>
                <span id="productGalleryCounter" class="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[10px] font-mono text-white">1 / ${images.length}</span>
              ` : ''}
            </div>
            ${images.length > 1 ? `
              <div id="productGalleryThumbnails" class="flex gap-2 overflow-x-auto pb-1">
                ${images.map((image, index) => `
                  <button type="button" onclick="changeProductGalleryImage(${index}, true)" aria-label="View product photo ${index + 1}" aria-current="${index === 0 ? 'true' : 'false'}" class="product-gallery-thumbnail h-14 w-14 shrink-0 overflow-hidden rounded border ${index === 0 ? 'border-cyber-red' : 'border-cyber-border'}">
                    <img src="${escapeHtml(image)}" alt="" class="h-full w-full object-cover">
                  </button>
                `).join('')}
              </div>
            ` : ''}
            <div class="bg-cyber-dark p-3 rounded-lg border border-cyber-border space-y-1 text-xs font-mono">
              <span class="text-cyber-muted block">GUARANTEED AUTHENTICITY</span>
              <p class="text-green-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> ZEL Tech Inspection Passed</p>
              <p class="text-[11px] text-cyber-muted">Includes 1-Year Hardware Warranty.</p>
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
                <span class="text-2xl font-mono font-black text-white">${formatCurrency(item.price)}</span>
              </div>
              <div class="text-right">
                <span class="text-[10px] font-mono text-cyber-red block">TRADE CREDIT ALLOWANCE</span>
                <span class="text-sm font-mono font-bold text-cyber-red">Up to ${formatCurrency(item.tradeValue)} Off</span>
              </div>
            </div>

            <div class="space-y-2 pt-2">
              <button onclick="addToCart(${jsArgument(item.id)}); closeProductModal();" class="w-full py-3 bg-cyber-red hover:bg-cyber-redGlow text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg shadow-neon transition flex items-center justify-center">
                <i class="fa-solid fa-cart-shopping mr-2"></i> Add To Cart — ${formatCurrency(item.price)}
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

    function changeProductGalleryImage(direction, selectIndex = false) {
      const product = products.find(item => item.id === activeProductGalleryProductId);
      if (!product) return;
      const images = product.images && product.images.length ? product.images : [product.image];
      activeProductGalleryIndex = selectIndex
        ? direction
        : (activeProductGalleryIndex + direction + images.length) % images.length;
      const image = document.getElementById('productGalleryMainImage');
      const counter = document.getElementById('productGalleryCounter');
      if (image) {
        image.src = images[activeProductGalleryIndex];
        image.alt = `${product.title} photo ${activeProductGalleryIndex + 1} of ${images.length}`;
      }
      if (counter) counter.textContent = `${activeProductGalleryIndex + 1} / ${images.length}`;
      document.querySelectorAll('.product-gallery-thumbnail').forEach((thumbnail, index) => {
        const selected = index === activeProductGalleryIndex;
        thumbnail.setAttribute('aria-current', String(selected));
        thumbnail.classList.toggle('border-cyber-red', selected);
        thumbnail.classList.toggle('border-cyber-border', !selected);
        if (selected) thumbnail.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
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
        subtotalEl.innerText = formatCurrency(0, 2);
        grandTotalEl.innerText = formatCurrency(0, 2);
        discountRow.style.display = 'none';
        return;
      }

      container.innerHTML = cart.map(item => `
        <div class="flex items-center space-x-3 bg-cyber-card p-3 rounded-lg border border-cyber-border">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="w-14 h-14 object-cover rounded bg-cyber-dark">
          <div class="flex-1 min-w-0 font-mono">
            <h5 class="text-xs font-bold text-white truncate">${escapeHtml(item.title)}</h5>
            <span class="text-[10px] text-cyber-muted block">${escapeHtml(item.condition)}</span>
            <div class="text-xs font-bold text-cyber-red mt-1">${formatCurrency(item.price * item.qty)}</div>
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

      subtotalEl.innerText = formatCurrency(subtotal, 2);

      if (promoDiscountPercent > 0) {
        discountRow.style.display = 'flex';
        discountEl.innerText = `-${formatCurrency(discount, 2)}`;
      } else {
        discountRow.style.display = 'none';
      }

      grandTotalEl.innerText = formatCurrency(grandTotal, 2);
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
        activePromoCode = '';
        msg.className = "text-[11px] text-cyber-red block font-mono";
        msg.innerText = "Invalid Promo Code. Try: NEON2025";
      }
      if (promoDiscountPercent > 0) activePromoCode = input;
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

      document.getElementById('checkoutPayableAmount').innerText = formatCurrency(payable, 2);
      document.getElementById('checkoutShippingName').value = currentUser.name || '';
      document.getElementById('checkoutShippingEmail').value = currentUser.email || '';
      
      const modal = document.getElementById('checkoutModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function updatePaymentInstructions() {
      const selectedMethod = document.querySelector('input[name="payMethod"]:checked');
      const instructions = document.getElementById('paymentInstructions');
      if (!selectedMethod) {
        instructions.textContent = 'Choose a payment method. Online and bank payments are recorded as pending; payment processing is not connected yet.';
      } else if (selectedMethod.value === 'cash_on_delivery') {
        instructions.textContent = 'Cash on delivery is recorded as due on delivery. Payment collection is handled outside this site.';
      } else {
        instructions.textContent = 'This payment method will be recorded as pending. Payment processing is not connected yet; no online charge or bank transfer is made by this site.';
      }
    }

    function closeCheckoutModal() {
      const modal = document.getElementById('checkoutModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    async function processCheckout(e) {
      e.preventDefault();
      if (!requireSignIn(() => document.getElementById('checkoutForm').requestSubmit())) return;
      if (!supabaseClient || cart.length === 0) {
        showToast('Your account service or cart is unavailable. Refresh and try again.');
        return;
      }

      const selectedMethod = document.querySelector('input[name="payMethod"]:checked');
      if (!selectedMethod) {
        showToast('Choose a payment method to continue.');
        return;
      }

      const btn = document.getElementById('btnConfirmPay');
      const originalButtonContent = btn.innerHTML;
      btn.classList.add('button-loading');
      btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Processing Order...`;
      btn.disabled = true;
      const cartSnapshot = cart.map(item => ({ ...item }));
      try {
        const { data, error } = await supabaseClient.rpc('place_marketplace_order', {
          p_items: cartSnapshot.map(item => ({ listing_id: item.id, quantity: item.qty })),
          p_shipping_name: document.getElementById('checkoutShippingName').value.trim(),
          p_shipping_email: document.getElementById('checkoutShippingEmail').value.trim(),
          p_shipping_address: document.getElementById('checkoutShippingAddress').value.trim(),
          p_city: document.getElementById('checkoutCity').value.trim(),
          p_province: document.getElementById('checkoutProvince').value.trim(),
          p_postal_code: document.getElementById('checkoutPostalCode').value.trim(),
          p_payment_method: selectedMethod.value,
          p_promo_code: activePromoCode
        });
        if (error) throw error;
        if (!data || !data.order_number) throw new Error('Supabase did not return the saved order number.');

        const newOrder = {
          id: data.order_number,
          databaseId: data.id,
          date: new Date(data.created_at).toLocaleDateString(),
          items: cartSnapshot,
          total: Number(data.total),
          status: data.status,
          trackingNumber: 'Not assigned',
          buyerEmail: currentUser.email,
          paymentMethod: selectedMethod.value,
          paymentStatus: data.payment_status
        };
        orders.unshift(newOrder);
        cartSnapshot.forEach(item => {
          const product = products.find(listing => listing.id === item.id);
          if (product) product.stock -= item.qty;
        });
        products = products.filter(product => product.stock > 0);
        cart = [];
        promoDiscountPercent = 0;
        activePromoCode = '';
        document.getElementById('promoCodeInput').value = '';
        persistData();
        renderCart();
        closeCheckoutModal();

        try {
          await Promise.all([loadUserOrders(), loadListings()]);
        } catch (refreshError) {
          console.error('The order was saved, but marketplace data could not refresh.', refreshError);
          showToast(`Order saved, but marketplace data could not refresh: ${refreshError.message || 'Please reload.'}`);
        }

        const itemCount = cartSnapshot.reduce((sum, item) => sum + item.qty, 0);
        document.getElementById('orderConfirmSubtitle').innerText = `Order #${newOrder.id} has been saved.`;
        document.getElementById('orderSuccessDetails').innerHTML = `
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Order Status:</span>
            <span class="text-cyber-red font-bold">${escapeHtml(newOrder.status)}</span>
          </div>
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Items Purchased:</span>
            <span>${itemCount} units</span>
          </div>
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Payment Status:</span>
            <span>${escapeHtml(newOrder.paymentStatus.replace(/_/g, ' '))}</span>
          </div>
          <div class="flex justify-between border-b border-cyber-border pb-1">
            <span>Order Total:</span>
            <span class="text-white font-bold">${formatCurrency(newOrder.total, 2)}</span>
          </div>
        `;

        const successModal = document.getElementById('orderSuccessModal');
        successModal.classList.remove('hidden');
        successModal.classList.add('flex');
      } catch (error) {
        console.error('Unable to place marketplace order.', error);
        const setupHint = ['PGRST202', '42883'].includes(error.code)
          ? ' Run the latest supabase-setup.sql in your Supabase SQL Editor, then try again.'
          : '';
        showToast(`Unable to place order: ${error.message || 'Please try again.'}${setupHint}`);
      } finally {
        btn.innerHTML = originalButtonContent;
        btn.disabled = false;
        btn.classList.remove('button-loading');
      }
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
          ${escapeHtml(p.title)} (${escapeHtml(p.condition)}) — Listed ${formatCurrency(p.price)}
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
      
      let base = 30000;
      if (cond === 'Mint') base = 35000;
      if (cond === 'Good') base = 28000;
      if (cond === 'Fair') base = 20000;
      if (cond === 'Damaged Screen') base = 12000;

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
        summaryText.innerHTML = `<span class="text-green-400 font-bold"><i class="fa-solid fa-circle-check"></i> Fair &amp; Balanced Exchange (${formatCurrency(netOfferValue)} vs ${formatCurrency(targetVal)})</span>`;
      } else if (diff < 0) {
        summaryText.innerHTML = `<span class="text-amber-400 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Offer is ${formatCurrency(Math.abs(diff))} lower than target. Consider adding cash top-up.</span>`;
      } else {
        summaryText.innerHTML = `<span class="text-cyber-red font-bold"><i class="fa-solid fa-arrow-trend-up"></i> Your offer exceeds target value by ${formatCurrency(diff)}! Advantageous for seller.</span>`;
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
        notes: notes || "Hardware tested and ready for dispatch.",
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
          ? (t.cashDirection === 'i_pay' ? `+ Buyer adds ${formatCurrency(t.cashDelta)} cash` : `+ Requests ${formatCurrency(t.cashDelta)} cash from seller`)
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
                <div class="text-xs text-cyber-red mt-0.5">Est. Value: ${formatCurrency(t.estimatedValue)} (${escapeHtml(t.condition)})</div>
              </div>
              <div class="sm:border-l sm:border-cyber-border sm:pl-3 pt-2 sm:pt-0">
                <span class="text-[10px] text-cyber-muted block">REQUESTED TECH</span>
                <div class="text-sm font-bold text-white">${escapeHtml(t.targetProduct)}</div>
                <div class="text-xs text-green-400 mt-0.5">${cashText}</div>
              </div>
            </div>

            <!-- Notes -->
            <p class="text-xs text-gray-300 font-sans italic line-clamp-2">
              "${escapeHtml((t.notes || '').replace(/ready for escrow dispatch/gi, 'ready for dispatch'))}"
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
        showToast(`Trade proposal #${tradeId} accepted.`);
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

      const counterCash = prompt(`Enter Counter-Offer Cash Amount for Trade #${tradeId} (Current: ${formatCurrency(trade.cashDelta)}):`, trade.cashDelta + 50);
      if (counterCash !== null && !isNaN(counterCash)) {
        trade.status = "Counter-Offered";
        trade.cashDelta = parseFloat(counterCash);
        trade.notes = `Counter-offer updated: Cash adjustment revised to ${formatCurrency(counterCash)}.`;
        persistData();
        renderTradesFeed();
        renderUserDashboard();
        showToast(`Counter-offer of ${formatCurrency(counterCash)} submitted for #${tradeId}!`);
      }
    }

    /* ----------------------------------------------------
       SELLER PORTAL: LIST NEW DEVICE
    ---------------------------------------------------- */
    function renderListingImagePreviews() {
      const container = document.getElementById('listingImagePreviews');
      if (!container) return;
      container.innerHTML = selectedListingImages.map((item, index) => `
        <div class="relative aspect-square overflow-hidden rounded border border-cyber-border">
          <img src="${escapeHtml(item.previewUrl)}" alt="Selected product photo ${index + 1}" class="h-full w-full object-cover">
          <button type="button" onclick="removeListingImage(${index})" aria-label="Remove product photo ${index + 1}" class="absolute right-1 top-1 rounded bg-black/80 px-1.5 py-1 text-xs text-white hover:bg-cyber-red">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `).join('');
    }

    function handleListingImageSelection(event) {
      const input = event.target;
      const files = Array.from(input.files || []);
      input.value = '';
      let rejected = 0;
      for (const file of files) {
        if (selectedListingImages.length >= 6) {
          rejected += 1;
          continue;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          rejected += 1;
          continue;
        }
        selectedListingImages.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      renderListingImagePreviews();
      if (rejected) showToast('Some photos were skipped. Upload up to 6 JPEG, PNG, or WebP images, each no larger than 5 MB.');
    }

    function removeListingImage(index) {
      const [removed] = selectedListingImages.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderListingImagePreviews();
    }

    function clearListingImageSelection() {
      selectedListingImages.forEach(item => URL.revokeObjectURL(item.previewUrl));
      selectedListingImages = [];
      renderListingImagePreviews();
    }

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

      if (!selectedListingImages.length && !imgUrl) {
        imgUrl = 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?auto=format&fit=crop&w=700&q=80';
      }

      const uploadedImageUrls = [];
      const uploadedImagePaths = [];
      try {
        for (const [index, item] of selectedListingImages.entries()) {
          const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
          const filePath = `${currentUser.id}/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${extensionByType[item.file.type]}`;
          const { error: uploadError } = await supabaseClient.storage
            .from('product-images')
            .upload(filePath, item.file, { cacheControl: '3600', upsert: false, contentType: item.file.type });
          if (uploadError) throw uploadError;
          uploadedImagePaths.push(filePath);
          const { data: publicUrlData } = supabaseClient.storage.from('product-images').getPublicUrl(filePath);
          const imageUrl = safeImageUrl(publicUrlData.publicUrl);
          if (!imageUrl) throw new Error('Supabase returned an invalid product photo URL.');
          uploadedImageUrls.push(imageUrl);
        }
      } catch (error) {
        console.error('Unable to upload product photos.', error);
        if (uploadedImagePaths.length) {
          const { error: cleanupError } = await supabaseClient.storage.from('product-images').remove(uploadedImagePaths);
          if (cleanupError) console.error('Unable to clean up uploaded product photos.', cleanupError);
        }
        showToast(`Unable to upload product photos: ${error.message}`);
        return;
      }

      const images = uploadedImageUrls.length ? uploadedImageUrls : [imgUrl];
      imgUrl = images[0];

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
        images: images,
        rating: 5.0,
        stock: 1,
        description: `Seller listing. Specifications: ${specs}.`,
        approval_status: 'pending'
      };

      const { data, error } = await supabaseClient
        .from('listings')
        .insert(listing)
        .select('id')
        .single();
      if (error) {
        console.error('Unable to create listing.', error);
        if (uploadedImagePaths.length) {
          const { error: cleanupError } = await supabaseClient.storage.from('product-images').remove(uploadedImagePaths);
          if (cleanupError) console.error('Unable to clean up product photos for the failed listing.', cleanupError);
        }
        showToast(`Unable to create listing: ${error.message}`);
        return;
      }
      if (!data) {
        showToast('The listing was submitted, but its status could not be confirmed. Refresh your account before submitting it again.');
        return;
      }

      document.getElementById('sellDeviceForm').reset();
      clearListingImageSelection();
      let listingStatusLoaded = true;
      let listingStatusError = '';
      try {
        await loadUserListings();
      } catch (error) {
        listingStatusLoaded = false;
        listingStatusError = error.message || 'Please refresh your account.';
        console.error('The listing was submitted, but member listings could not refresh.', error);
      }
      showToast(listingStatusLoaded
        ? `Device "${title}" submitted for admin approval. It will appear in the store after approval.`
        : `Device "${title}" was submitted, but your listing status could not be loaded: ${listingStatusError}`);
      switchView('dashboard');
      switchDashTab('mylistings');
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
              <div class="text-cyber-muted text-[11px] mt-0.5">Cash adjustment: ${formatCurrency(t.cashDelta)} (${escapeHtml(t.cashDirection)})</div>
            </div>
            <div class="flex items-center space-x-3">
              <span class="px-2.5 py-1 rounded text-[11px] font-bold border ${t.status === 'Accepted' ? 'border-green-500 text-green-400' : 'border-cyber-border text-white'}">${escapeHtml(t.status)}</span>
              <button onclick="openTradeNegotiatePrompt('${t.id}')" class="px-3 py-1 bg-cyber-dark hover:bg-cyber-red rounded text-white border border-cyber-border transition">Negotiate</button>
            </div>
          </div>
        `).join('');
      }

      // 2. Orders
      const ordersContainer = document.getElementById('userOrdersList');
      const myOrders = [...orders, ...legacyOrders].filter(order => order.buyerEmail === currentUser.email);
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
              <span class="text-green-400 font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">${escapeHtml((ord.status || '').replace(/\s*\/\s*Escrow Locked/i, ''))}</span>
            </div>
            <div class="flex justify-between items-center text-gray-300">
              <div>
                ${ord.items.map(i => `<div>${i.qty}x ${escapeHtml(i.title)}</div>`).join('')}
              </div>
              <div class="text-right">
                <span class="text-cyber-muted text-[10px] block">ORDER TOTAL</span>
                <span class="text-sm font-bold text-white">${formatCurrency(ord.total, 2)}</span>
              </div>
            </div>
            <div class="pt-2 border-t border-cyber-border/60 flex items-center justify-between text-[11px] text-cyber-muted">
              <span><i class="fa-solid fa-truck text-cyber-red mr-1"></i> ${ord.trackingNumber && ord.trackingNumber !== 'Not assigned' ? `Tracking: ${escapeHtml(ord.trackingNumber)}` : 'Tracking not assigned yet'}</span>
              ${ord.paymentStatus ? `<span class="text-cyber-muted">${escapeHtml(ord.paymentStatus.replace(/_/g, ' '))}</span>` : ''}
            </div>
          </div>
        `).join('');
      }

      // 3. User Listings
      const userListingsContainer = document.getElementById('userListingsGrid');
      const myItems = userListings;
      if (myItems.length === 0) {
        userListingsContainer.innerHTML = '<p class="col-span-full text-xs text-cyber-muted font-mono py-8 text-center">You have not listed any electronics yet.</p>';
        updateDashboardCounts();
        return;
      }
      userListingsContainer.innerHTML = myItems.map(p => `
        <div class="tech-card reveal-on-scroll bg-cyber-card p-3 rounded-xl border border-cyber-border font-mono text-xs space-y-2">
          <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" loading="lazy" decoding="async" class="h-28 w-full object-cover rounded bg-cyber-dark">
          <div class="font-bold text-white truncate">${escapeHtml(p.title)}</div>
          <div class="flex justify-between text-cyber-muted text-[11px]">
            <span>Price: ${formatCurrency(p.price)}</span>
            <span>${escapeHtml(p.condition)}</span>
          </div>
          <div class="text-[11px] ${p.approvalStatus === 'approved' ? 'text-emerald-400' : p.approvalStatus === 'rejected' ? 'text-red-300' : 'text-amber-300'}">
            ${p.approvalStatus === 'approved' ? (p.isActive ? 'Approved · Live' : 'Approved · Hidden') : p.approvalStatus === 'rejected' ? 'Rejected · Remove and resubmit' : 'Pending admin approval'}
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
      const myOrders = [...orders, ...legacyOrders].filter(order => order.buyerEmail === currentUser.email);
      const myListings = userListings;
      renderProfileAvatar(currentUser.avatarUrl);
      document.getElementById('profileName').textContent = currentUser.name || 'Member';
      document.getElementById('profileEmail').textContent = currentUser.email;
      document.getElementById('profileNameInput').value = currentUser.name || '';
      document.getElementById('profilePhone').textContent = currentUser.phone || 'Not provided';
      document.getElementById('profileLocation').textContent = currentUser.location || 'Not provided';
      document.getElementById('profileActivity').textContent =
        `${myListings.length} listings | ${myTrades.length} trade offers | ${myOrders.length} orders`;
    }

    function renderProfileAvatar(url) {
      const avatar = document.querySelector('.profile-avatar');
      if (!avatar) return;
      const avatarUrl = String(url || '');
      const safeUrl = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(avatarUrl)
        ? avatarUrl
        : safeImageUrl(avatarUrl);
      avatar.innerHTML = safeUrl
        ? `<img src="${escapeHtml(safeUrl)}" alt="Profile picture" class="h-full w-full object-cover">`
        : '<i class="fa-solid fa-user-astronaut"></i>';
    }

    async function previewProfileAvatar(event) {
      const input = event.currentTarget;
      const file = input.files && input.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
        input.value = '';
        selectedProfileAvatar = null;
        renderProfileAvatar(currentUser && currentUser.avatarUrl);
        showToast('Choose a JPEG, PNG, or WebP image under 3 MB.');
        return;
      }

      selectedProfileAvatar = file;
      const reader = new FileReader();
      reader.onload = () => {
        if (selectedProfileAvatar === file) renderProfileAvatar(String(reader.result || ''));
      };
      reader.onerror = () => {
        if (selectedProfileAvatar !== file) return;
        selectedProfileAvatar = null;
        input.value = '';
        renderProfileAvatar(currentUser && currentUser.avatarUrl);
        showToast('The selected profile picture could not be previewed.');
      };
      reader.readAsDataURL(file);

      if (!currentUser || !supabaseClient) {
        selectedProfileAvatar = null;
        input.value = '';
        renderProfileAvatar(currentUser && currentUser.avatarUrl);
        showToast('Sign in before uploading a profile picture.');
        return;
      }

      const userId = currentUser.id;
      input.disabled = true;
      const saveButton = document.getElementById('saveProfileButton');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving picture...';
      let uploadedFilePath = '';
      try {
        const extension = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp'
        }[file.type];
        uploadedFilePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabaseClient.storage
          .from('profile-avatars')
          .upload(uploadedFilePath, file, {
            cacheControl: '3600',
            contentType: file.type,
            upsert: false
          });
        if (uploadError) throw uploadError;

        const avatarUrl = supabaseClient.storage.from('profile-avatars').getPublicUrl(uploadedFilePath).data.publicUrl;
        const { data, error } = await supabaseClient
          .from('profiles')
          .update({ avatar_url: avatarUrl })
          .eq('id', userId)
          .select('avatar_url')
          .single();
        if (error) throw error;

        if (currentUser && currentUser.id === userId) currentUser.avatarUrl = data.avatar_url || avatarUrl;
        selectedProfileAvatar = null;
        input.value = '';
        if (currentUser && currentUser.id === userId) renderProfileAvatar(currentUser.avatarUrl);
        showToast('Profile picture saved.');
      } catch (error) {
        console.error('Unable to save the profile picture.', error);
        if (uploadedFilePath) {
          try {
            const { error: cleanupError } = await supabaseClient.storage.from('profile-avatars').remove([uploadedFilePath]);
            if (cleanupError) console.error('Unable to clean up the unsaved profile picture.', cleanupError);
          } catch (cleanupError) {
            console.error('Unable to clean up the unsaved profile picture.', cleanupError);
          }
        }
        selectedProfileAvatar = null;
        input.value = '';
        if (currentUser && currentUser.id === userId) renderProfileAvatar(currentUser.avatarUrl);
        const setupHint = error.code === '42703' || /bucket.*not found|avatar_url|row-level security|violates.*policy/i.test(error.message || '')
          ? ' Run the latest supabase-setup.sql in the Supabase SQL Editor.'
          : '';
        showToast(`Unable to save profile picture: ${error.message || 'Please try again.'}${setupHint}`);
      } finally {
        input.disabled = false;
        saveButton.disabled = false;
        saveButton.textContent = 'Save Profile';
      }
    }

    function setProfileEditMode(isEditing) {
      const form = document.getElementById('profileEditForm');
      const editButton = document.getElementById('editProfileButton');
      form.classList.toggle('hidden', !isEditing);
      editButton.classList.toggle('hidden', isEditing);
      if (isEditing && currentUser) {
        document.getElementById('profileNameInput').value = currentUser.name || '';
        document.getElementById('profilePhoneInput').value = currentUser.phone || '';
        document.getElementById('profileLocationInput').value = currentUser.location || '';
        document.getElementById('profileAvatarInput').value = '';
        selectedProfileAvatar = null;
        document.getElementById('profileNameInput').focus();
      } else {
        selectedProfileAvatar = null;
        document.getElementById('profileAvatarInput').value = '';
        renderProfileAvatar(currentUser && currentUser.avatarUrl);
      }
    }

    async function saveProfile(event) {
      event.preventDefault();
      if (!currentUser || !supabaseClient) {
        showToast('Sign in before editing your profile.');
        return;
      }

      const name = document.getElementById('profileNameInput').value.trim();
      const phone = document.getElementById('profilePhoneInput').value.trim();
      const location = document.getElementById('profileLocationInput').value.trim();
      if (!name || name.length > 80) {
        showToast('Enter a display name between 1 and 80 characters.');
        return;
      }
      if (phone.length > 30 || location.length > 120) {
        showToast('Phone numbers must be 30 characters or less and locations 120 characters or less.');
        return;
      }

      const saveButton = document.getElementById('saveProfileButton');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      try {
        let avatarUrl = currentUser.avatarUrl || '';
        const { data, error } = await supabaseClient
          .from('profiles')
          .update({ display_name: name, avatar_url: avatarUrl })
          .eq('id', currentUser.id)
          .select('display_name, avatar_url')
          .single();
        if (error) throw error;

        const { data: privateData, error: privateError } = await supabaseClient
          .from('member_private_profiles')
          .update({ phone, location })
          .eq('id', currentUser.id)
          .select('phone, location')
          .single();
        if (privateError) throw privateError;

        currentUser.name = data.display_name;
        currentUser.avatarUrl = data.avatar_url || '';
        currentUser.phone = privateData.phone || '';
        currentUser.location = privateData.location || '';
        selectedProfileAvatar = null;
        products.forEach(product => {
          if (product.sellerId === currentUser.id) product.sellerName = data.display_name;
        });
        renderCatalog();
        renderUserDashboard();
        setProfileEditMode(false);
        showToast('Profile updated.');
      } catch (error) {
        console.error('Unable to update the member profile.', error);
        showToast(`Unable to update profile: ${error.message || 'Please try again.'}`);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Profile';
      }
    }

    function setupScrollReveals(root = document) {
      const elements = root.querySelectorAll('.reveal-on-scroll:not(.is-visible)');
      if (!elements.length) return;
      if (!('IntersectionObserver' in window)) {
        elements.forEach(element => element.classList.add('is-visible'));
        return;
      }

      if (!scrollRevealObserver) {
        scrollRevealObserver = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            scrollRevealObserver.unobserve(entry.target);
          });
        }, { rootMargin: '0px 0px 80px 0px', threshold: 0.08 });
      }
      elements.forEach(element => scrollRevealObserver.observe(element));
    }

    async function removeListing(prodId) {
      if (!requireSignIn(() => removeListing(prodId))) return;
      const listing = userListings.find(product => product.id === prodId);
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
      userListings = userListings.filter(item => item.id !== prodId);
      renderCatalog();
      renderUserDashboard();
      showToast('Listing removed.');
    }

    function updateDashboardCounts() {
      const myTrades = currentUser
        ? trades.filter(trade => trade.proposerEmail === currentUser.email || trade.sellerId === currentUser.id)
        : [];
      const myOrders = currentUser
        ? [...orders, ...legacyOrders].filter(order => order.buyerEmail === currentUser.email)
        : [];
      const myListings = currentUser ? userListings : [];
      document.getElementById('dashTradeCount').innerText = myTrades.length;
      document.getElementById('dashOrderCount').innerText = myOrders.length;
      document.getElementById('dashListingCount').innerText = myListings.length;
      document.getElementById('activeTradesBadge').innerText = myTrades.length;
      renderHomeDashboard();
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
      showInteractionLoader();
      const button = event.target.closest('button:not(:disabled)');
      if (!button) return;

      button.classList.remove('button-pressed');
      void button.offsetWidth;
      button.classList.add('button-pressed');
    });

    ['authEmail', 'authPassword'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        const message = document.getElementById('authErrorMessage');
        message.textContent = '';
        message.classList.add('hidden');
      });
    });

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      document.addEventListener('pointermove', event => {
        const card = event.target.closest('.tech-card');
        if (!card) return;
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
        card.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
      }, { passive: true });
    }

    window.addEventListener('popstate', () => switchView(getViewFromLocation(), false));
  