const marketplaceBenefits=[["🔒","Secure Shopping","Account and checkout protection."],["🚚","Order Tracking","Track purchases from confirmation to delivery."],["⭐","Trusted Reviews","Use ratings to make informed decisions."],["💬","Buyer & Seller Chat","Communicate directly about listings."]];function renderMarketplaceBenefits(){const el=document.getElementById("marketplaceBenefits");if(el)el.innerHTML=marketplaceBenefits.map(([i,t,d])=>`<div class="dash-card-static"><div class="icon">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join("");}
/* ============================= DATA ============================= */
const orders=[];
const conversations=[];

// Backend-ready collections. Orders and messages intentionally start empty.
let ordersLoading=false;
let messagesLoading=false;
const backendCache={orders:[],conversations:[]};

const appState={products:[],cart:[],selectedProduct:null};
let category="All",role="",activeUser={name:"",email:""},currentPage="dashboard",activeConvId=1;

const buyerFeatures=[
["🛍️","Product Marketplace","Browse products with photos, prices, ratings, stock and seller details."],
["🔎","Search & Filters","Search by product, category, price and rating."],
["🛒","Shopping Cart","Add products, change quantities and calculate totals."],
["❤️","Wishlist","Save products for future purchases."],
["💳","Checkout","Review address, shipping, payment and order total."],
["📦","Order Tracking","Track pending, shipped and delivered orders."],
["⭐","Reviews & Ratings","Rate purchased products and read buyer reviews."],
["💬","Seller Chat","Ask questions about products before purchasing."],
 ["🔁","Trade Hub","Exchange products or combine items with cash."]
];
const sellerFeatures=[
["📊","Seller Dashboard","View revenue, orders, products, customers and store performance."],
["➕","Add Products","Add photos, name, category, description, price and stock."],
["📦","Inventory","Monitor stock and receive low-stock alerts."],
["🧾","Order Management","Accept, prepare, ship, cancel and complete customer orders."],
["💰","Sales & Earnings","Track daily, weekly and monthly sales and earnings."],
["🎁","Promotions","Create discounts, vouchers and special offers."],
["⭐","Reviews","View ratings and respond to customer feedback."],
["💬","Buyer Messages","Chat with customers and answer product questions."],
 ["🔁","Trade Hub","Review exchange proposals and negotiate fair deals."]
];

/* ============================= MARKETPLACE (public) ============================= */
function money(n){return "₱"+n.toLocaleString("en-PH",{minimumFractionDigits:2})}
const API_CONFIG={
 productsEndpoint:"/api/products",
 cartEndpoint:"/api/cart/items",
 ordersEndpoint:"/api/orders",
 conversationsEndpoint:"/api/messages/conversations",
 messagesEndpoint:"/api/messages",
 dashboardEndpoint:"/api/dashboard",
 localProductsKey:"zel_products_v1"
};

function loadLocalProducts(){
 try{
  const raw=localStorage.getItem(API_CONFIG.localProductsKey);
  const parsed=raw?JSON.parse(raw):[];
  return Array.isArray(parsed)?parsed:[];
 }catch(error){
  console.warn("Could not read local ZEL products.",error);
  return [];
 }
}
function saveLocalProducts(){
 try{localStorage.setItem(API_CONFIG.localProductsKey,JSON.stringify(appState.products));}
 catch(error){console.warn("Could not save ZEL products locally.",error);}
}
function normalizeProduct(product={}){
 return {
  id:product.id??`local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
  name:String(product.name||"Unnamed Product"),
  category:String(product.category||"Uncategorized"),
  price:Number(product.price)||0,
  old:product.old!=null?Number(product.old):undefined,
  stock:Number(product.stock)||0,
  sku:String(product.sku||`ZEL-${Date.now()}`),
  image:String(product.image||""),
  description:String(product.description||"No description provided."),
  rating:Number(product.rating)||0,
  sold:Number(product.sold)||0,
  emoji:product.emoji||"🛍️",
  seller:product.seller||{name:activeUser?.name||"Marketplace Seller",location:"Philippines",store:"ZEL Seller Store",rating:5},
  specifications:product.specifications||product.specs||{}
 };
}
async function fetchProducts(){
 /* BACKEND INTEGRATION: GET your authenticated product collection here. */
 if(location.protocol==="file:") return loadLocalProducts();
 const response=await fetch(API_CONFIG.productsEndpoint,{headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error(`Product API returned ${response.status}`);
 const payload=await response.json();
 const remote=Array.isArray(payload)?payload:(payload.products||payload.data||[]);
 return remote.map(normalizeProduct);
}
async function handleAddNewProduct(productPayload){
 /*
  BACKEND INTEGRATION:
  POST productPayload to /api/products when your backend is connected.
  The local fallback below makes the single HTML file fully usable without a backend.
 */
 const localProduct=normalizeProduct(productPayload);
 appState.products.unshift(localProduct);
 saveLocalProducts();
 renderProducts();
 renderPage();

 if(location.protocol!=="file:"){
  try{
   const response=await fetch(API_CONFIG.productsEndpoint,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(productPayload)});
   if(response.ok){
    const createdPayload=await response.json();
    const created=normalizeProduct(createdPayload.product||createdPayload.data||createdPayload);
    const index=appState.products.findIndex(p=>String(p.id)===String(localProduct.id));
    if(index>=0)appState.products[index]=created;
    saveLocalProducts();
    renderProducts();
    renderPage();
    return created;
   }
   console.warn(`Product API returned ${response.status}; local product was kept.`);
  }catch(error){
   console.warn("Product API unavailable; product was saved locally.",error);
  }
 }
 return localProduct;
}
async function initializeProducts(){
 const localProducts=loadLocalProducts().map(normalizeProduct);
 appState.products.splice(0,appState.products.length,...localProducts);
 renderProducts();
 updateCart();

 if(location.protocol!=="file:"){
  try{
   const remoteProducts=await fetchProducts();
   const byId=new Map(appState.products.map(p=>[String(p.id),p]));
   remoteProducts.forEach(product=>byId.set(String(product.id),product));
   appState.products.splice(0,appState.products.length,...byId.values());
   saveLocalProducts();
   renderProducts();
   if(currentPage!=="dashboard")renderPage();
  }catch(error){
   console.warn("ZEL product API is not connected. Local products remain available.",error);
  }
 }
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));}
function getProductById(id){return appState.products.find(p=>String(p.id)===String(id));}
function emptyProductState(){return `<div class="empty-state"><div class="empty-icon">◈</div><h3>No products available</h3><p>Connect ZEL to your product API or add a listing from Seller Center.</p></div>`;}
function renderProductCard(p){
 const visual=p.image?`<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">`:`<span aria-hidden="true">${p.emoji||"🛍️"}</span>`;
 const sellerName=typeof p.seller==="object"?(p.seller.name||"Marketplace Seller"):(p.seller||"Marketplace Seller");
 const id=String(p.id).replace(/'/g,"\\'");
 return `<article class="product" tabindex="0" role="button" aria-label="View details for ${escapeHtml(p.name)}" onclick="openProductDetails('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductDetails('${id}')}" >
 <button class="heart" aria-label="Add ${escapeHtml(p.name)} to wishlist" onclick="event.stopPropagation();wishlist('${id}')">♡</button>
 <div class="product-img">${visual}</div><div class="product-body"><div class="stars">★★★★★ <span>${Number(p.rating||0).toFixed(1)}</span></div><div class="product-title">${escapeHtml(p.name)}</div><div><span class="price">${money(Number(p.price)||0)}</span>${p.old?`<span class="old">${money(Number(p.old))}</span>`:""}</div><div class="sold">${Number(p.sold||0).toLocaleString()} sold</div><div class="seller">🏪 ${escapeHtml(sellerName)} · ${escapeHtml(p.category||"Uncategorized")}</div><button class="add" onclick="handleAddToCart('${id}',event)">Add to Cart</button></div></article>`;
}
function openProductDetails(id){const product=getProductById(id);if(!product)return toast("Product details are unavailable.");appState.selectedProduct=product;const modal=document.getElementById("productDetailsModal"),content=document.getElementById("productDetailsContent");if(!modal||!content)return;content.innerHTML=renderProductDetails(product);modal.classList.remove("hidden");document.body.classList.add("modal-open");setTimeout(()=>document.getElementById("detailQuantity")?.focus(),0);}
function closeProductDetails(){document.getElementById("productDetailsModal")?.classList.add("hidden");appState.selectedProduct=null;document.body.classList.remove("modal-open");}
function renderProductDetails(p){
 const seller=typeof p.seller==="object"?p.seller:{name:p.seller||"Marketplace Seller"};const specs=p.specifications||p.specs||{};const entries=Object.entries(specs);const stock=Number(p.stock??0);const visual=p.image?`<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">`:`<span>${p.emoji||"🛍️"}</span>`;
 return `<div class="product-detail-grid"><div class="detail-visual">${visual}</div><div class="detail-info"><div class="detail-category">${escapeHtml(p.category||"Uncategorized")}</div><h2 id="productDetailTitle">${escapeHtml(p.name)}</h2><div class="detail-rating">★★★★★ <b>${Number(p.rating||0).toFixed(1)}</b><span>· ${Number(p.sold||0).toLocaleString()} units sold</span></div><div class="detail-price">${money(Number(p.price)||0)} ${p.old?`<del>${money(Number(p.old))}</del>`:""}</div><div class="detail-meta"><span>SKU</span><b>${escapeHtml(p.sku||"Not assigned")}</b></div><div class="detail-meta"><span>Availability</span><b class="${stock>0?"in-stock":"out-stock"}">${stock>0?`${stock} units available`:"Out of stock"}</b></div><p class="detail-description">${escapeHtml(p.description||"Product description will be supplied by the backend listing.")}</p><div class="seller-panel"><div class="seller-avatar">${escapeHtml((seller.name||"S").slice(0,1).toUpperCase())}</div><div><strong>${escapeHtml(seller.name||"Marketplace Seller")}</strong><span>${escapeHtml(seller.location||seller.store||"Verified marketplace seller")}</span></div><div class="seller-rating">★ ${Number(seller.rating??p.rating??0).toFixed(1)}</div></div><div class="detail-actions"><label>Quantity<input id="detailQuantity" type="number" min="1" max="${Math.max(1,stock)}" value="1" ${stock<=0?"disabled":""}></label><button class="primary" ${stock<=0?"disabled":""} onclick="addSelectedProductToCart(event)">Add to Cart</button><button class="detail-buy" ${stock<=0?"disabled":""} onclick="buySelectedProduct(event)">Buy Now</button></div></div></div><div class="detail-specs"><h3>Full Specifications</h3>${entries.length?`<div class="spec-grid">${entries.map(([k,v])=>`<div><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("")}</div>`:`<p>No specifications supplied yet. The backend can populate this section from the product record.</p>`}</div>`;
}
async function addSelectedProductToCart(event){event?.stopPropagation();if(!appState.selectedProduct)return;const qty=Math.max(1,Number(document.getElementById("detailQuantity")?.value)||1);await handleAddToCart(appState.selectedProduct.id,event,qty);}
async function buySelectedProduct(event){event?.stopPropagation();if(!appState.selectedProduct)return;const qty=Math.max(1,Number(document.getElementById("detailQuantity")?.value)||1);await handleAddToCart(appState.selectedProduct.id,event,qty);closeProductDetails();openCart();}
function filterCategory(c){category=c;renderProducts();document.getElementById("products").scrollIntoView({behavior:"smooth"})}
async function renderProducts(){
 const q=document.getElementById("searchInput")?.value?.trim().toLowerCase()||"",sort=document.getElementById("sort")?.value||"popular";
 let list=appState.products.filter(p=>(category==="All"||p.category===category)&&[p.name,p.category,p.seller?.name,p.seller].filter(Boolean).join(" ").toLowerCase().includes(q));
 if(sort==="low")list.sort((a,b)=>(a.price??0)-(b.price??0));if(sort==="high")list.sort((a,b)=>(b.price??0)-(a.price??0));if(sort==="rating")list.sort((a,b)=>(b.rating??0)-(a.rating??0));
 const grid=document.getElementById("productGrid");if(grid)grid.innerHTML=list.length?list.map(renderProductCard).join(""):emptyProductState();
}

async function handleAddToCart(id,event,quantity=1){
 event?.stopPropagation();const product=getProductById(id);if(!product)return toast("Product is no longer available.");if(Number(product.stock??0)<=0)return toast("This product is out of stock.");const qty=Math.max(1,Number(quantity)||1);const existing=appState.cart.find(x=>String(x.id)===String(id));if(existing)existing.qty+=qty;else appState.cart.push({...product,qty});updateCart();toast("Added to cart: "+product.name);/* BACKEND: POST API_CONFIG.cartEndpoint with {productId, quantity}. */
}

function updateCart(){
 const count=appState.cart.reduce((s,x)=>s+(Number(x.qty)||0),0),countEl=document.getElementById("cartCount");if(countEl){countEl.textContent=count;countEl.classList.toggle("hidden",count===0);}const el=document.getElementById("cartItems");if(!el)return;el.innerHTML=appState.cart.length?appState.cart.map(x=>`<div class="cart-item"><div class="emoji">${x.image?`<img src="${escapeHtml(x.image)}" alt="${escapeHtml(x.name)}">`:(x.emoji||"🛍️")}</div><div style="flex:1"><b>${escapeHtml(x.name)}</b><p style="color:var(--muted);font-size:12px">${money(Number(x.price)||0)} × ${x.qty}</p><button onclick="removeCart('${String(x.id).replace(/'/g,"\\'")}')" style="color:var(--danger);background:none;margin-top:5px;font-weight:600;font-size:12.5px">Remove</button></div></div>`).join(""):"<p style='color:var(--muted)'>Your cart is empty. Add products from the marketplace.</p>";const total=appState.cart.reduce((s,x)=>s+(Number(x.price)||0)*(Number(x.qty)||0),0);const totalEl=document.getElementById("cartTotal");if(totalEl)totalEl.innerHTML=appState.cart.length?`<div class="cart-total"><span>Total</span><span>${money(total)}</span></div><button class="primary" style="width:100%;margin-top:15px" onclick="checkout()">Proceed to Checkout</button>`:"";
}

function removeCart(id){const index=appState.cart.findIndex(x=>String(x.id)===String(id));if(index>=0)appState.cart.splice(index,1);updateCart();}

function openCart(){document.getElementById("cartPanel").classList.remove("hidden");updateCart()}
function closeCart(){document.getElementById("cartPanel").classList.add("hidden")}
function checkout(){if(!appState.cart.length)return;toast("Checkout ready — review your delivery and payment details.")}
function wishlist(id){toast("Product saved to your wishlist ❤️")}

/* ============================= AUTH ============================= */
function openAuth(r){
 role=r;
 document.getElementById("roleOverlay").classList.add("hidden");
 document.getElementById("authModal").classList.remove("hidden");
 document.getElementById("authTitle").textContent=r==="buyer"?"👤 Buyer Login":"🏪 Seller Login";
 document.getElementById("authDesc").textContent=r==="buyer"?"Access your shopping cart, orders, wishlist and checkout.":"Access your store, products, inventory, orders and sales.";
 document.getElementById("featureTitle").textContent=r==="buyer"?"Buyer Features":"Seller Features";
 document.getElementById("featureList").innerHTML=(r==="buyer"?buyerFeatures:sellerFeatures).map(f=>`<div class="feature"><b>${f[0]} ${f[1]}</b>${f[2]}</div>`).join("");
}
function closeAuth(){document.getElementById("authModal").classList.add("hidden");document.getElementById("roleOverlay").classList.remove("hidden")}

function initials(name){return name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase()}

function login(e){
 e.preventDefault();
 const name=document.getElementById("fullName").value||"Guest User";
 const email=document.getElementById("email").value;
 activeUser={name,email};
 document.getElementById("authModal").classList.add("hidden");
 document.getElementById("marketplace").classList.add("hidden");
 document.getElementById("app").classList.add("active");
 document.getElementById("topName").textContent=name;
 document.getElementById("topRole").textContent=role==="buyer"?"Buyer":"Seller";
 document.getElementById("topAvatar").textContent=initials(name);
 buildSidebar();
 goPage("dashboard");
 toast(role==="buyer"?"Buyer account logged in.":"Seller account logged in.");
}
function logout(){
 document.getElementById("app").classList.remove("active");
 document.getElementById("marketplace").classList.remove("hidden");
 document.getElementById("roleOverlay").classList.remove("hidden");
 toast("You have been logged out.");
}

/* ============================= SIDEBAR / ROUTER ============================= */
const sellerNav=[
 ["dashboard","🏠","Dashboard"],
 ["products","📦","My Products"],
 ["orders","🧾","Orders"],
 ["customers","👥","Customers"],
 ["messages","💬","Messages"],
 ["analytics","📈","Analytics"],
 ["settings","⚙️","Store Settings"],
 ["profile","👤","Seller Profile"],
 ["trade","🔁","Trade Hub"]
];
const buyerNav=[
 ["dashboard","🏠","Dashboard"],
 ["browse","🛍️","Marketplace"],
 ["orders","📦","My Orders"],
 ["wishlist","❤️","Wishlist"],
 ["messages","💬","Messages"],
 ["cart","🛒","My Cart"],
 ["profile","👤","My Profile"],
 ["trade","🔁","Trade Hub"]
];
function buildSidebar(){
 const nav=role==="seller"?sellerNav:buyerNav;
 document.getElementById("sidebarNav").innerHTML=nav.map(n=>`
  <button class="side-link" data-page="${n[0]}" onclick="goPage('${n[0]}')">
   <span class="ic">${n[1]}</span> ${n[2]}
   ${n[3]?`<span class="side-badge">${n[3]}</span>`:""}
  </button>`).join("");
}
function goPage(page){
 currentPage=page;
 document.querySelectorAll(".side-link[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
 renderPage();
 window.scrollTo({top:0});
}
function renderPage(){
 const body=document.getElementById("pageBody");
 if(currentPage==="dashboard")body.innerHTML=role==="seller"?dashboardSeller():dashboardBuyer();
 else if(currentPage==="products")body.innerHTML=pageProducts();
 else if(currentPage==="browse")body.innerHTML=pageBrowse();
 else if(currentPage==="orders")body.innerHTML=pageOrders();
 else if(currentPage==="customers")body.innerHTML=pageCustomers();
 else if(currentPage==="messages")body.innerHTML=pageMessages();
 else if(currentPage==="analytics")body.innerHTML=pageAnalytics();
 else if(currentPage==="settings")body.innerHTML=pageSettings();
 else if(currentPage==="wishlist")body.innerHTML=pageWishlist();
 else if(currentPage==="cart")body.innerHTML=pageCartInline();
 else if(currentPage==="profile")body.innerHTML=pageProfile();
 else if(currentPage==="trade")body.innerHTML=pageTradeHub();
 if(currentPage==="messages"){
  renderConversationList();
  if(activeConvId!=null)selectConv(activeConvId);
 }
}

/* ---------- Dashboard ---------- */
function emptyState(title,text,icon="○"){
 return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}
function dashboardSeller(){
 const totalSales=orders.reduce((sum,o)=>sum+Number(o.total||0),0);
 const pending=orders.filter(o=>String(o.status||"").toLowerCase()==="pending").length;
 const customers=new Set(orders.map(o=>o.cust).filter(Boolean)).size;
 return `
 <div class="page-head"><h1>🏪 Seller Dashboard</h1><p></p></div>
 <div class="stats">
  <div class="stat"><div class="row"><small>Total Sales</small><div class="ic">💰</div></div><h2>${money(totalSales)}</h2><div class="delta"></div></div>
  <div class="stat"><div class="row"><small>Orders</small><div class="ic">🧾</div></div><h2>${orders.length}</h2><div class="delta">${pending} pending</div></div>
  <div class="stat"><div class="row"><small>Products</small><div class="ic">📦</div></div><h2>${appState.products.length}</h2><div class="delta">From product collection</div></div>
  <div class="stat"><div class="row"><small>Customers</small><div class="ic">👥</div></div><h2>${customers}</h2><div class="delta">From orders</div></div>
 </div>
 <div class="two-col">
  <div class="card"><div class="card-head"><h3>Recent Orders</h3><span class="link-btn" onclick="goPage('orders')">View all</span></div>${orders.length?ordersTable(orders.slice(0,5)):emptyState("No orders yet","Connect your orders API or place an order to see it here.","🧾")}</div>
  <div class="card"><div class="card-head"><h3>Low Stock Alerts</h3><span class="link-btn" onclick="goPage('products')">Manage</span></div>${appState.products.filter(p=>Number(p.stock)<20).length?appState.products.filter(p=>Number(p.stock)<20).map(p=>`
   <div class="row-flex" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)"><div class="mini-thumb">${p.emoji}</div><div style="flex:1"><div style="font-weight:700;font-size:13px">${escapeHtml(p.name)}</div><small style="color:var(--muted)">${Number(p.stock)===0?"Out of stock":Number(p.stock)+" units left"}</small></div><span class="badge ${Number(p.stock)===0?'red':'amber'}">${Number(p.stock)===0?"Out of stock":"Low"}</span></div>`).join(""):emptyState("No low stock alerts","Your current product collection has no low stock items.","✓")}</div>
 </div>`;
}
function dashboardBuyer(){
 const cartItems=appState.cart.reduce((s,x)=>s+x.qty,0);
 const active=orders.filter(o=>!["Delivered","Cancelled"].includes(o.status)).length;
 return `
 <div class="page-head"><h1>👤 Buyer Dashboard</h1><p>
 <div class="stats">
  <div class="stat"><div class="row"><small>Cart Items</small><div class="ic">🛒</div></div><h2>${cartItems}</h2><div class="delta">Local cart</div></div>
  <div class="stat"><div class="row"><small>Active Orders</small><div class="ic">📦</div></div><h2>${active}</h2><div class="delta">Backend data</div></div>
  <div class="stat"><div class="row"><small>Wishlist</small><div class="ic">❤️</div></div><h2>0</h2><div class="delta">No wishlist data connected</div></div>
  <div class="stat"><div class="row"><small>Reviews Given</small><div class="ic">⭐</div></div><h2>0</h2><div class="delta">No review data connected</div></div>
 </div>
 <div class="card"><div class="card-head"><h3>Recent Orders</h3><span class="link-btn" onclick="goPage('orders')">View all</span></div>${orders.length?ordersTable(orders.slice(0,4)):emptyState("No orders yet","Your orders will appear here after the backend returns order data.","📦")}</div>`;
}
function ordersTable(list){
 if(!list.length)return emptyState("No orders found","Connect /api/orders to populate this table.","🧾");
 return `<table><thead><tr><th>Order</th><th>Item</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>
 ${list.map(o=>`<tr><td>#${escapeHtml(o.id)}</td><td>${escapeHtml(o.item)}</td><td>${escapeHtml(o.date)}</td><td>${money(Number(o.total)||0)}</td><td><span class="badge ${statusColor(o.status)}">${escapeHtml(o.status||"Unknown")}</span></td></tr>`).join("")}
 </tbody></table>`;
}
function statusColor(s){return s==="Delivered"?"green":s==="Shipped"?"blue":s==="Cancelled"?"red":"amber"}

async function fetchBackendCollection(endpoint){
 if(location.protocol==="file:")return [];
 const response=await fetch(endpoint,{headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error(`API ${endpoint} returned ${response.status}`);
 const payload=await response.json();
 return Array.isArray(payload)?payload:(payload.orders||payload.conversations||payload.data||[]);
}
async function initializeOrders(){
 ordersLoading=true;
 try{
  const data=await fetchBackendCollection(API_CONFIG.ordersEndpoint);
  orders.splice(0,orders.length,...data);
  backendCache.orders=[...orders];
 }catch(error){
  console.warn("Orders API unavailable; orders remain empty.",error);
 }finally{
  ordersLoading=false;
  if(currentPage==="dashboard"||currentPage==="orders")renderPage();
 }
}
async function initializeMessages(){
 messagesLoading=true;
 try{
  const data=await fetchBackendCollection(API_CONFIG.conversationsEndpoint);
  conversations.splice(0,conversations.length,...data.map(c=>({...c,msgs:Array.isArray(c.msgs)?c.msgs:[]})));
  backendCache.conversations=[...conversations];
  activeConvId=conversations[0]?.id||null;
 }catch(error){
  console.warn("Messages API unavailable; messages remain empty.",error);
 }finally{
  messagesLoading=false;
  if(currentPage==="messages"||currentPage==="customers")renderPage();
 }
}
/* ---------- My Products (seller) ---------- */
function pageProducts(){return `<div class="page-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h1>📦 My Products</h1><p>Manage listings from the live product collection.</p></div><button class="primary" onclick="showNewProductForm()">+ Add Product</button></div><div class="mgmt-grid">${appState.products.length?appState.products.map(renderManagementCard).join(""):`<div class="empty-state full-span"><div class="empty-icon">＋</div><h3>No listings yet</h3><p>Create your first product listing to populate Seller Center.</p></div>`}</div>`;}
function renderManagementCard(p){const id=String(p.id).replace(/'/g,"\\'");return `<div class="mgmt-card"><div class="mgmt-thumb">${p.image?`<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">`:(p.emoji||"🛍️")}</div><div class="mgmt-body"><h4>${escapeHtml(p.name)}</h4><div style="color:var(--muted);font-size:12.5px">${escapeHtml(p.category||"Uncategorized")}</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="price" style="font-size:16px">${money(Number(p.price)||0)}</span><span class="badge ${Number(p.stock||0)===0?'red':Number(p.stock)<20?'amber':'green'}">${Number(p.stock||0)===0?"Out of stock":Number(p.stock)+" in stock"}</span></div><div class="mgmt-actions"><button class="btn-outline" onclick="showNewProductForm(getProductById('${id}'))">✏️ Edit</button><button class="btn-danger-outline" onclick="deleteProduct('${id}')">🗑 Remove</button></div></div></div>`;}
function showNewProductForm(existing=null){const body=document.getElementById("pageBody");if(!body)return;const p=existing||{};body.insertAdjacentHTML("beforeend",`<div id="newProductOverlay" class="modal"><div class="modal-card product-form-card"><div class="modal-head"><div><h2>${existing?"Edit Product":"Add New Product"}</h2><p>Submit listing data to your product API.</p></div><button class="close" onclick="document.getElementById('newProductOverlay')?.remove()">✕</button></div><form onsubmit="submitProductForm(event,${existing?"true":"false"})" data-product-id="${escapeHtml(p.id||"")}"><div class="pf-grid"><div class="input"><label>Product Name</label><input name="name" required value="${escapeHtml(p.name||"")}"></div><div class="input"><label>Category</label><input name="category" required value="${escapeHtml(p.category||"")}"></div><div class="input"><label>Price</label><input name="price" type="number" min="0" step="0.01" required value="${p.price??""}"></div><div class="input"><label>Stock</label><input name="stock" type="number" min="0" required value="${p.stock??""}"></div><div class="input"><label>SKU</label><input name="sku" value="${escapeHtml(p.sku||"")}"></div><div class="input"><label>Image URL</label><input name="image" type="url" value="${escapeHtml(p.image||"")}"></div><div class="input" style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="4">${escapeHtml(p.description||"")}</textarea></div></div><button class="primary" type="submit">${existing?"Save Changes":"Create Product"}</button></form></div></div>`);}
async function submitProductForm(event,isEdit){
 event.preventDefault();
 const form=event.currentTarget;
 const data=Object.fromEntries(new FormData(form).entries());
 data.price=Number(data.price);
 data.stock=Number(data.stock);
 if(!data.sku)data.sku=`ZEL-${Date.now()}`;
 try{
  if(isEdit){
   const id=form.dataset.productId;
   const index=appState.products.findIndex(p=>String(p.id)===String(id));
   if(index<0)throw new Error("Product not found");
   const updated={...appState.products[index],...normalizeProduct({...appState.products[index],...data,id})};
   appState.products[index]=updated;
   saveLocalProducts();
   renderProducts();
   renderPage();

   if(location.protocol!=="file:"){
    try{
     /* BACKEND INTEGRATION: PATCH /api/products/:id */
     const r=await fetch(`${API_CONFIG.productsEndpoint}/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(data)});
     if(r.ok){
      const payload=await r.json();
      const serverProduct=normalizeProduct(payload.product||payload.data||payload);
      const serverIndex=appState.products.findIndex(p=>String(p.id)===String(id));
      if(serverIndex>=0)appState.products[serverIndex]=serverProduct;
      saveLocalProducts();renderProducts();renderPage();
     }
    }catch(error){console.warn("Update API unavailable; local changes were kept.",error);}
   }
  }else{
   await handleAddNewProduct(data);
  }
  document.getElementById("newProductOverlay")?.remove();
  renderPage();
  renderProducts();
  toast(isEdit?"Product updated successfully.":"Product created successfully!");
 }catch(error){
  console.error(error);
  toast("Could not save product.");
 }
}
async function deleteProduct(id){
 if(!confirm("Remove this product?"))return;
 const index=appState.products.findIndex(p=>String(p.id)===String(id));
 if(index<0)return;
 appState.products.splice(index,1);
 saveLocalProducts();
 renderProducts();renderPage();
 if(location.protocol!=="file:"){
  try{
   /* BACKEND INTEGRATION: DELETE /api/products/:id */
   const r=await fetch(`${API_CONFIG.productsEndpoint}/${encodeURIComponent(id)}`,{method:"DELETE"});
   if(!r.ok)console.warn(`Delete API returned ${r.status}; local deletion was kept.`);
  }catch(error){console.warn("Delete API unavailable; local deletion was kept.",error);}
 }
 toast("Product removed.");
}

function pageBrowse(){
 setTimeout(()=>{renderInnerProducts()},0);
 return `
 <div class="page-head"><h1>🛍️ Marketplace</h1><p>Discover products from trusted sellers.</p></div>
 <div class="section-head">
  <input id="innerSearch" oninput="renderInnerProducts()" placeholder="Search products..." style="padding:11px 14px;border:1px solid var(--border);border-radius:9px;width:280px">
  <select id="innerSort" onchange="renderInnerProducts()"><option value="popular">Popular</option><option value="low">Price: Low to High</option><option value="high">Price: High to Low</option><option value="rating">Top Rated</option></select>
 </div>
 <div id="innerGrid" class="products"></div>`;
}
function renderInnerProducts(){const q=(document.getElementById("innerSearch")?.value||"").toLowerCase(),sort=document.getElementById("innerSort")?.value||"popular";let list=appState.products.filter(p=>[p.name,p.category,p.seller?.name,p.seller].filter(Boolean).join(" ").toLowerCase().includes(q));if(sort==="low")list.sort((a,b)=>(a.price??0)-(b.price??0));if(sort==="high")list.sort((a,b)=>(b.price??0)-(a.price??0));if(sort==="rating")list.sort((a,b)=>(b.rating??0)-(a.rating??0));const grid=document.getElementById("innerGrid");if(grid)grid.innerHTML=list.length?list.map(renderProductCard).join(""):emptyProductState();}

function pageOrders(){
 return `
 <div class="page-head"><h1>🧾 ${role==="seller"?"Orders":"My Orders"}</h1><p>${role==="seller"?"Accept, prepare and ship customer orders.":"Track and review your recent purchases."}</p></div>
 <div class="card">${ordersTable(orders)}</div>`;
}

/* ---------- Customers (seller) ---------- */
function pageCustomers(){
 if(!conversations.length)return `<div class="page-head"><h1>👥 Customers</h1><p>Customers will appear here from your backend data.</p></div><div class="card">${emptyState("No customers yet","Connect your backend to populate customer records.","👥")}</div>`;
 return `<div class="page-head"><h1>👥 Customers</h1><p>People who have purchased from your store.</p></div><div class="card"><table><thead><tr><th>Customer</th><th>Location</th><th>Orders</th><th>Rating Given</th></tr></thead><tbody>${conversations.map(c=>`<tr><td class="row-flex"><div class="conv-avatar" style="width:32px;height:32px;font-size:12px">${initials(c.name||"")}</div>${escapeHtml(c.name||"Unknown")}</td><td>${escapeHtml(c.city||"")}</td><td>${Number(c.ordersCount||0)}</td><td>${c.rating!=null?"★ "+escapeHtml(c.rating):"—"}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- Messages ---------- */
function pageMessages(){
 return `<div class="page-head"><h1>💬 Messages</h1><p>Chat with your ${role==="seller"?"customers":"sellers"} using backend conversation data.</p></div>
 <div class="msg-shell">
  <div class="msg-list"><div class="msg-search"><input id="messageSearch" placeholder="Search messages..." oninput="renderConversationList()"></div><div class="msg-tabs"><span class="msg-tab active">All (${conversations.length})</span><span class="msg-tab">Unread (${conversations.filter(c=>c.unread).length})</span></div><div class="conv-scroll" id="convScroll"></div></div>
  <div class="chat-col" id="chatCol">${conversations.length?emptyState("Select a conversation","Choose a conversation to start chatting.","💬"):emptyState("No messages yet","Connect /api/messages/conversations to populate your inbox.","💬")}</div>
  <div class="cust-panel" id="custPanel"></div>
 </div>`;
}
function renderConversationList(){
 const q=(document.getElementById("messageSearch")?.value||"").toLowerCase();
 const list=conversations.filter(c=>[c.name,c.last,c.city].filter(Boolean).join(" ").toLowerCase().includes(q));
 const el=document.getElementById("convScroll");
 if(!el)return;
 el.innerHTML=list.length?list.map(c=>`<div class="conv-item ${c.id===activeConvId?'active':''}" onclick="selectConv('${String(c.id).replace(/'/g,"\\'")}')"><div class="conv-avatar">${initials(c.name||"")}</div><div class="conv-meta"><div class="top-row"><b>${escapeHtml(c.name||"Unknown")}</b><span>${escapeHtml(c.time||"")}</span></div><p>${escapeHtml(c.last||"")}</p></div>${c.unread?`<span class="side-badge" style="margin-left:0">${Number(c.unread)}</span>`:""}</div>`).join(""):emptyState("No conversations","No backend conversation records match your search.","💬");
}
async function selectConv(id){
 activeConvId=id;
 const c=conversations.find(x=>String(x.id)===String(id));
 if(!c)return;
 c.unread=0;
 renderConversationList();
 const messages=Array.isArray(c.msgs)?c.msgs:[];
 document.getElementById("chatCol").innerHTML=`<div class="chat-head"><div class="conv-avatar">${initials(c.name||"")}</div><div><div style="font-weight:800;font-size:14px">${escapeHtml(c.name||"Unknown")}</div><div class="status"><i></i>${c.online?"Online":"Offline"}</div></div></div><div class="chat-body">${messages.length?messages.map(m=>`<div class="bubble-row ${m.me?'me':''}"><div><div class="bubble">${escapeHtml(m.t||"")}</div><div class="bubble-time">${escapeHtml(m.time||"")}</div></div></div>`).join(""):emptyState("No messages yet","This conversation has no messages.","💬")}</div><div class="chat-input"><input id="chatInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMsg('${String(c.id).replace(/'/g,"\\'")}')"><button class="send" onclick="sendMsg('${String(c.id).replace(/'/g,"\\'")}')">➤</button></div>`;
 document.getElementById("custPanel").innerHTML=`<div class="center"><div class="avatar-lg">${initials(c.name||"")}</div><h4>${escapeHtml(c.name||"Unknown")}</h4><div class="muted">${c.rating!=null?"★ "+escapeHtml(c.rating)+" rating":"No rating"}</div></div><div class="cust-detail"><span>📍 Location</span><span>${escapeHtml(c.city||"—")}</span></div><div class="cust-detail"><span>📋 Orders</span><span>${Number(c.ordersCount||0)}</span></div>`;
}
async function sendMsg(id){
 const input=document.getElementById("chatInput");
 const message=input?.value.trim();
 if(!message)return;
 const c=conversations.find(x=>String(x.id)===String(id));
 if(!c)return;
 const localMessage={me:true,t:message,time:"Just now"};
 c.msgs=Array.isArray(c.msgs)?c.msgs:[];
 c.msgs.push(localMessage);c.last=message;c.time="Just now";input.value="";selectConv(id);
 if(location.protocol!=="file:"){
  try{
   const response=await fetch(API_CONFIG.messagesEndpoint,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({conversationId:id,message})});
   if(!response.ok)throw new Error(`Message API returned ${response.status}`);
   const payload=await response.json();
   const saved=payload.message||payload.data;
   if(saved){c.msgs[c.msgs.length-1]=saved.me===undefined?{...saved,me:true}:saved;selectConv(id);}
  }catch(error){console.warn("Message API unavailable; message kept in UI.",error);}
 }
}
/* ---------- Analytics (seller) ---------- */
function pageAnalytics(){
 const best=[...appState.products].sort((a,b)=>b.sold-a.sold).slice(0,5);
 return `
 <div class="page-head"><h1>📈 Analytics</h1><p>See your best-selling products and store trends.</p></div>
 <div class="card">
  <div class="card-head"><h3>Best-Selling Products</h3></div>
  <table><thead><tr><th>Product</th><th>Category</th><th>Sold</th><th>Rating</th></tr></thead><tbody>
  ${best.map(p=>`<tr><td class="row-flex"><div class="mini-thumb">${p.emoji}</div>${p.name}</td><td>${p.category}</td><td>${p.sold.toLocaleString()}</td><td>★ ${p.rating}</td></tr>`).join("")}
  </tbody></table>
 </div>`;
}

/* ---------- Store settings (seller) ---------- */
function pageSettings(){
 return `
 <div class="page-head"><h1>⚙️ Store Settings</h1><p>Manage your store name, description and contact details.</p></div>
 <div class="card">
  <div class="pf-grid">
   <div class="pf-field"><label>Store Name</label><input value="TechWorld Store"></div>
   <div class="pf-field"><label>Store Category</label><input value="Electronics"></div>
   <div class="pf-field" style="grid-column:1/-1"><label>Store Description</label><textarea rows="3">Your one-stop shop for the latest gadgets, electronics, and accessories. Quality products at the best prices!</textarea></div>
   <div class="pf-field"><label>Contact Email</label><input value="${activeUser.email||'johndoe@email.com'}"></div>
   <div class="pf-field"><label>Contact Phone</label><input value="+63 912 345 6789"></div>
  </div>
  <button class="primary" style="margin-top:16px" onclick="toast('Store settings saved.')">Save Changes</button>
 </div>`;
}

/* ---------- Wishlist / Cart (buyer) ---------- */
function pageWishlist(){
 return `<div class="page-head"><h1>❤️ Wishlist</h1><p>Products you've saved for later.</p></div>
 <div class="products">${appState.products.slice(0,4).map(p=>`
 <article class="product"><div class="product-img">${p.emoji}</div><div class="product-body">
  <div class="product-title">${p.name}</div><div class="price">${money(p.price)}</div>
  <button class="add" onclick="handleAddToCart(${p.id})">Add to Cart</button></div></article>`).join("")}</div>`;
}
function pageCartInline(){
 const total=appState.cart.reduce((s,x)=>s+x.price*x.qty,0);
 return `<div class="page-head"><h1>🛒 My Cart</h1><p>Review items before checkout.</p></div>
 <div class="card">
 ${appState.cart.length?appState.cart.map(x=>`<div class="cart-item"><div class="emoji">${x.emoji}</div><div style="flex:1"><b>${x.name}</b><p style="color:var(--muted);font-size:12px">${money(x.price)} × ${x.qty}</p><button onclick="removeCart(${x.id});renderPage()" style="color:var(--danger);background:none;margin-top:5px;font-weight:600;font-size:12.5px">Remove</button></div></div>`).join(""):"<p style='color:var(--muted)'>Your cart is empty. Visit the marketplace to add products.</p>"}
 ${appState.cart.length?`<div class="cart-total"><span>Total</span><span>${money(total)}</span></div><button class="primary" style="width:100%;margin-top:15px" onclick="checkout()">Proceed to Checkout</button>`:""}
 </div>`;
}

/* ---------- Profile page ---------- */
function pageProfile(){
 const isSeller=role==="seller";
 const bio=isSeller?"Quality appState.products, best prices, and reliable service. Thank you for supporting my small business!":"Loves a good deal — always on the hunt for quality appState.products at fair prices.";
 return `
 <div class="page-head"><h1>${isSeller?"👤 Seller Profile":"👤 My Profile"}</h1><p>Manage your account${isSeller?" and store information":""}.</p></div>
 <div class="profile-head">
  <div class="profile-avatar-wrap"><div class="profile-avatar">${initials(activeUser.name||"John Doe")}</div><div class="cam-btn">📷</div></div>
  <div>
   <h2>${activeUser.name||"John Doe"} <span class="verified">✔</span></h2>
   <span class="role-pill">${isSeller?"Seller":"Buyer"}</span>
   <p class="bio">${bio}</p>
   <button class="btn-outline" style="margin-top:12px;padding:9px 16px;border-radius:8px;font-weight:700;font-size:13px" onclick="toast('Edit profile (demo)')">✏️ Edit Profile</button>
  </div>
  <div class="contact-col">
   <div class="contact-row">✉️ ${activeUser.email||"johndoe@email.com"}</div>
   <div class="contact-row">📞 +63 912 345 6789</div>
   <div class="contact-row">📍 123 Market St. City, Philippines</div>
   <div class="contact-row">📅 Member since Apr 2025</div>
  </div>
 </div>
 <div class="two-col">
  <div class="card">
   <div class="card-head"><h3>Personal Information</h3></div>
   <div class="pf-grid">
    <div class="pf-field"><label>Full Name</label><input value="${activeUser.name||'John Doe'}"></div>
    <div class="pf-field"><label>Username</label><input value="${(activeUser.name||'johndoe').toLowerCase().replace(/\s+/g,'')}"></div>
    <div class="pf-field"><label>Email Address</label><input value="${activeUser.email||'johndoe@email.com'}"></div>
    <div class="pf-field"><label>Phone Number</label><input value="+63 912 345 6789"></div>
    <div class="pf-field" style="grid-column:1/-1"><label>About Me</label><textarea rows="3">${bio}</textarea><div class="charcount">${bio.length}/500</div></div>
   </div>
   <button class="primary" style="margin-top:14px" onclick="toast('Information updated.')">Edit Information</button>
  </div>
  <div>
   <div class="rating-box" style="margin-bottom:16px">
    <div class="rline"><div class="row-flex"><div class="gold-circle">⭐</div><div><small>${isSeller?"Store Rating":"Buyer Rating"}</small><div style="font-weight:800;font-size:17px">4.8</div></div></div><small class="muted" style="color:var(--muted)">(24 reviews)</small></div>
    <div class="rline"><div class="row-flex"><div class="blue-circle">🛡️</div><div><small>${isSeller?"Seller ID":"Buyer ID"}</small><div style="font-weight:800">#${isSeller?"S":"B"}12345</div></div></div></div>
    <div class="rline"><div class="row-flex"><div class="green-circle">🏬</div><div><small>${isSeller?"Store Status":"Account Status"}</small><div><span class="badge green">Active</span></div></div></div></div>
   </div>
   ${isSeller?`
   <div class="card">
    <div class="card-head"><h3>Store Information</h3><span class="link-btn" onclick="toast('Edit store (demo)')">Edit Store</span></div>
    <div class="row-flex" style="margin-bottom:14px"><div class="store-thumb">🏪</div><div><div style="font-weight:800">TechWorld Store</div><small class="muted" style="color:var(--muted)">Electronics · Gadgets · Accessories</small></div></div>
    <div class="store-line"><span>Store Name</span><span>TechWorld Store</span></div>
    <div class="store-line"><span>Store Category</span><span>Electronics</span></div>
    <div class="store-line"><span>Store Address</span><span>123 Market St.</span></div>
    <div class="perf-grid">
     <div class="perf-item"><small>Total Products</small><div class="n">${appState.products.length}</div></div>
     <div class="perf-item"><small>Total Orders</small><div class="n">48</div></div>
     <div class="perf-item"><small>Total Sales</small><div class="n">${money(48590)}</div></div>
     <div class="perf-item"><small>Store Rating</small><div class="n">4.8</div></div>
    </div>
   </div>` : `
   <div class="card">
    <div class="card-head"><h3>Shipping Address</h3><span class="link-btn" onclick="toast('Edit address (demo)')">Edit</span></div>
    <p style="font-size:13.5px;color:var(--muted);line-height:1.7">123 Market St.<br>Quezon City, Metro Manila<br>Philippines, 1100</p>
   </div>`}
  </div>
 </div>`;
}


/* ================= ZEL TRADE HUB — LOCAL FRONT-END WORKFLOW =================
   Trade listings and offers are stored in this browser until matching backend
   endpoints are connected. Existing marketplace/backend features are untouched.
*/
const TRADE_LISTINGS_KEY="zel_trade_listings_v1";
const TRADE_OFFERS_KEY="zel_trade_offers_v1";
let tradeFilter="all";
function readTradeStore(key){try{const v=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(v)?v:[]}catch(e){return[]}}
function saveTradeStore(){try{localStorage.setItem(TRADE_LISTINGS_KEY,JSON.stringify(tradeListings));localStorage.setItem(TRADE_OFFERS_KEY,JSON.stringify(tradeOffers))}catch(e){console.warn("Trade Hub local storage unavailable.",e)}}
let tradeListings=readTradeStore(TRADE_LISTINGS_KEY);
let tradeOffers=readTradeStore(TRADE_OFFERS_KEY);
function tradeSeedListings(){
 const existing=new Set(tradeListings.map(x=>String(x.productId||x.id)));
 appState.products.forEach((p,i)=>{
  if(!existing.has(String(p.id)) && tradeListings.length<3){
   tradeListings.push({id:"seed-"+p.id,productId:p.id,title:p.name,category:p.category||"General",description:"Open to fair exchanges. Send an offer to discuss the details.",value:Number(p.price)||0,condition:"Good",owner:p.seller?.name||"ZEL Community",location:p.seller?.location||"Philippines",wanted:"Similar-value items",emoji:p.emoji||"📦",createdAt:Date.now()+i});
  }
 });
 if(tradeListings.length)saveTradeStore();
}
function tradeMoney(v){return "₱"+(Number(v)||0).toLocaleString("en-PH",{maximumFractionDigits:2})}
function pageTradeHub(){
 tradeSeedListings();
 const active=tradeListings.filter(x=>tradeFilter==="all"||x.category.toLowerCase()===tradeFilter);
 const offerCount=tradeOffers.length;
 return `<div class="page-head"><h1>🔁 ZEL Trade Hub</h1><p>Exchange items, add cash to balance a deal, and negotiate directly with other members.</p></div>
 <section class="trade-hero"><div class="trade-kicker">More than buying and selling</div><h2>One item can unlock another.</h2><p>Trade what you own for something you need. Make a direct exchange, add cash when values differ, or propose a cash-plus-item deal. Every offer starts a conversation, and nothing is finalized until both sides agree.</p><div class="trade-actions"><button class="primary" onclick="openTradeListingForm()">＋ List an Item to Trade</button><button class="white-btn" onclick="showMyTradeOffers()">View My Offers (${offerCount})</button></div></section>
 <div class="stats"><div class="stat"><div class="row"><small>Available Trade Listings</small><div class="ic">🔁</div></div><h2>${tradeListings.length}</h2><div class="delta">Community listings</div></div><div class="stat"><div class="row"><small>Offers Sent / Received</small><div class="ic">🤝</div></div><h2>${offerCount}</h2><div class="delta">Stored on this device</div></div><div class="stat"><div class="row"><small>Trade Options</small><div class="ic">💸</div></div><h2>3</h2><div class="delta">Item, item + cash, cash + item</div></div><div class="stat"><div class="row"><small>Fair Deal Reminder</small><div class="ic">🛡️</div></div><h2>双方</h2><div class="delta">Both users must agree</div></div></div>
 <div class="section-head"><div><h2 style="color:#fff">Explore Trade Listings</h2><p style="color:#aaa3bd;font-size:13px">Find an item and send a proposal.</p><input id="tradeSearch" oninput="renderTradeCards()" placeholder="Search trade items..." style="margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:#100b24;color:#fff;width:min(320px,80vw)"></div><select id="tradeSort" onchange="renderTradeCards()"><option value="new">Newest first</option><option value="low">Value: Low to High</option><option value="high">Value: High to Low</option></select></div>
 <div class="trade-tabs"><button class="trade-tab ${tradeFilter==="all"?"active":""}" onclick="setTradeFilter('all')">All items</button><button class="trade-tab ${tradeFilter==="electronics"?"active":""}" onclick="setTradeFilter('electronics')">Electronics</button><button class="trade-tab ${tradeFilter==="fashion"?"active":""}" onclick="setTradeFilter('fashion')">Fashion</button><button class="trade-tab ${tradeFilter==="home"?"active":""}" onclick="setTradeFilter('home')">Home & Living</button><button class="trade-tab ${tradeFilter==="other"?"active":""}" onclick="setTradeFilter('other')">Other</button></div>
 <div id="tradeCards" class="trade-grid">${active.length?active.map(renderTradeCard).join(""):`<div class="trade-empty" style="grid-column:1/-1">No trade listings in this category yet. Be the first to list an item.</div>`}</div>
 <div class="card" style="margin-top:22px"><div class="card-head"><h3>How ZEL Trading Works</h3></div><div class="dash-cards-static"><div class="dash-card-static"><div class="icon">🔄</div><h3>1. Choose an item</h3><p>Browse listings and check item condition, details, and estimated value.</p></div><div class="dash-card-static"><div class="icon">💬</div><h3>2. Make an offer</h3><p>Offer an item, include additional cash, or propose a cash-plus-item deal.</p></div><div class="dash-card-static"><div class="icon">🤝</div><h3>3. Agree and exchange</h3><p>Discuss the terms and arrange a safe exchange only after both parties agree.</p></div><div class="dash-card-static"><div class="icon">🛡️</div><h3>Trade safely</h3><p>Inspect items, confirm values, and never send money before verifying the deal.</p></div></div></div>`;
}
function renderTradeCard(x){
 return `<article class="trade-card"><div class="trade-card-visual">${escapeHtml(x.emoji||"📦")}</div><div class="trade-card-body"><span class="trade-pill">${escapeHtml(x.category||"Other")}</span><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description||"No description provided.")}</p><div class="trade-value">${tradeMoney(x.value)} <small style="font-size:10px;color:#aaa3bd;font-weight:600">estimated value</small></div><p>Condition: <b>${escapeHtml(x.condition||"Not specified")}</b><br>Owner: ${escapeHtml(x.owner||"ZEL member")} · ${escapeHtml(x.location||"")}</p><p style="margin-top:7px">Looking for: <b>${escapeHtml(x.wanted||"Open to offers")}</b></p><div class="trade-card-actions"><button class="trade-primary" onclick="openTradeOffer('${String(x.id).replace(/'/g,"\\'")}')">Make an Offer</button><button class="trade-secondary" onclick="viewTradeListing('${String(x.id).replace(/'/g,"\\'")}')">Details</button></div></div></article>`;
}
function renderTradeCards(){
 const q=(document.getElementById("tradeSearch")?.value||"").toLowerCase();
 const sort=document.getElementById("tradeSort")?.value||"new";
 let list=tradeListings.filter(x=>(tradeFilter==="all"||x.category.toLowerCase()===tradeFilter)&&[x.title,x.category,x.description,x.wanted,x.owner].join(" ").toLowerCase().includes(q));
 if(sort==="low")list.sort((a,b)=>a.value-b.value);else if(sort==="high")list.sort((a,b)=>b.value-a.value);else list.sort((a,b)=>b.createdAt-a.createdAt);
 const el=document.getElementById("tradeCards");if(el)el.innerHTML=list.length?list.map(renderTradeCard).join(""):`<div class="trade-empty" style="grid-column:1/-1">No matching items. Try another category or list your own item.</div>`;
}
function setTradeFilter(v){tradeFilter=v;renderPage()}
function openTradeListingForm(){
 const body=document.getElementById("pageBody");if(!body)return;
 body.insertAdjacentHTML("beforeend",`<div class="modal" id="tradeListingModal"><div class="modal-card trade-modal"><div class="modal-head"><div><h2>List an Item for Trade</h2><p style="color:#aaa3bd;font-size:13px">Describe what you have and what you would like in return.</p></div><button class="close" onclick="document.getElementById('tradeListingModal').remove()">✕</button></div><form onsubmit="submitTradeListing(event)"><div class="trade-listing-form"><div><label>Item name</label><input name="title" required maxlength="80" placeholder="e.g. Wireless headphones"></div><div><label>Category</label><select name="category"><option>Electronics</option><option>Fashion</option><option>Home</option><option>Other</option></select></div><div><label>Estimated value (₱)</label><input name="value" type="number" min="0" step="1" required placeholder="e.g. 2500"></div><div><label>Item condition</label><select name="condition"><option>Like New</option><option>Good</option><option>Fair</option><option>For Parts / Repair</option></select></div><div class="wide"><label>Description</label><textarea name="description" rows="3" maxlength="500" placeholder="Describe the item's condition, age, and included accessories."></textarea></div><div class="wide"><label>What are you looking for?</label><input name="wanted" required placeholder="e.g. Android phone, tablet, or open to offers"></div><div><label>Location</label><input name="location" placeholder="City / Province"></div><div><label>Display emoji</label><select name="emoji"><option>📦</option><option>📱</option><option>💻</option><option>🎧</option><option>👟</option><option>👜</option><option>⌚</option><option>🎮</option><option>🏠</option></select></div></div><p class="trade-note">Only list items you own or are authorized to trade. Be accurate about condition and value.</p><button class="primary" type="submit" style="margin-top:16px">Publish Trade Listing</button></form></div></div>`);
}
function submitTradeListing(e){
 e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget).entries());
 const item={...data,id:"trade-"+Date.now(),value:Number(data.value)||0,owner:activeUser.name||"ZEL Member",createdAt:Date.now()};
 tradeListings.unshift(item);saveTradeStore();document.getElementById("tradeListingModal")?.remove();renderPage();toast("Your item is now listed in the Trade Hub.");
}
function openTradeOffer(id){
 const item=tradeListings.find(x=>String(x.id)===String(id));if(!item)return;
 const own=appState.products.filter(p=>Number(p.stock)>0);
 const body=document.getElementById("pageBody");
 body.insertAdjacentHTML("beforeend",`<div class="modal" id="tradeOfferModal"><div class="modal-card trade-modal"><div class="modal-head"><div><h2>Make a Trade Offer</h2><p style="color:#aaa3bd;font-size:13px">Propose a fair exchange for ${escapeHtml(item.title)}.</p></div><button class="close" onclick="document.getElementById('tradeOfferModal').remove()">✕</button></div><form onsubmit="submitTradeOffer(event,'${String(item.id).replace(/'/g,"\\'")}')"><div class="input"><label>Offer type</label><select name="type" id="tradeOfferType" onchange="toggleTradeCashFields()"><option value="item">Item for item</option><option value="item-cash">Item + additional cash</option><option value="cash-item">Cash + item (combined offer)</option><option value="cash">Cash offer only</option></select></div><div class="input" id="tradeOfferItemField"><label>Your item / product</label><select name="offeredItem"><option value="">Select your item</option>${own.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${tradeMoney(p.price)}</option>`).join("")}</select><p class="trade-note">Only products in your current product collection appear here. You can describe another item in the message below.</p></div><div class="input" id="tradeCashField"><label>Additional cash (₱)</label><input name="cash" type="number" min="0" step="1" value="0"></div><div class="input"><label>Message / counter terms</label><textarea name="message" rows="3" placeholder="Explain your offer, item condition, or proposed terms."></textarea></div><button class="primary" type="submit">Send Trade Proposal</button></form></div></div>`);
}
function toggleTradeCashFields(){
 const type=document.getElementById("tradeOfferType")?.value;
 const item=document.getElementById("tradeOfferItemField"),cash=document.getElementById("tradeCashField");
 if(item)item.classList.toggle("hidden",type==="cash");
 if(cash)cash.classList.toggle("hidden",type==="item");
}
function submitTradeOffer(e,id){
 e.preventDefault();const item=tradeListings.find(x=>String(x.id)===String(id));if(!item)return;
 const data=Object.fromEntries(new FormData(e.currentTarget).entries());
 if(data.type!=="cash"&&!data.offeredItem&&!data.message.trim())return toast("Select an item or describe your offer.");
 const offered=appState.products.find(p=>String(p.id)===String(data.offeredItem));
 tradeOffers.unshift({id:"offer-"+Date.now(),listingId:item.id,listingTitle:item.title,from:activeUser.name||"ZEL Member",type:data.type,itemName:offered?.name||"",cash:Number(data.cash)||0,message:data.message||"",status:"Pending",createdAt:Date.now()});
 saveTradeStore();document.getElementById("tradeOfferModal")?.remove();toast("Trade proposal saved. The other party can review it in My Offers.");renderPage();
}
function viewTradeListing(id){
 const x=tradeListings.find(v=>String(v.id)===String(id));if(!x)return;
 alert(`${x.title}\nEstimated value: ${tradeMoney(x.value)}\nCondition: ${x.condition}\nOwner: ${x.owner}\nLooking for: ${x.wanted}\n\n${x.description}`);
}
function showMyTradeOffers(){
 const body=document.getElementById("pageBody");if(!body)return;
 const rows=tradeOffers.length?tradeOffers.map(o=>`<div class="trade-offer-row"><div><b style="color:#fff">${escapeHtml(o.listingTitle)}</b><p style="font-size:12px;color:#aaa3bd;margin-top:4px">${escapeHtml(o.type)} · ${o.itemName?escapeHtml(o.itemName)+" · ":""}${tradeMoney(o.cash)} cash · ${escapeHtml(o.message)}</p><small style="color:#a69eb9">From ${escapeHtml(o.from)}</small></div><div style="text-align:right"><span class="trade-pill cash">${escapeHtml(o.status)}</span><div style="display:flex;gap:5px;margin-top:8px"><button class="trade-secondary" onclick="counterTradeOffer('${o.id}')">Counter</button><button class="trade-secondary" onclick="updateTradeOffer('${o.id}','Rejected')">Reject</button><button class="trade-primary" onclick="updateTradeOffer('${o.id}','Accepted')">Accept</button></div></div></div>`).join(""):`<div class="trade-empty">You haven't sent or received any trade proposals yet.</div>`;
 body.insertAdjacentHTML("beforeend",`<div class="modal" id="myTradeOffersModal"><div class="modal-card trade-modal"><div class="modal-head"><h2>My Trade Offers</h2><button class="close" onclick="document.getElementById('myTradeOffersModal').remove()">✕</button></div>${rows}<p class="trade-note">Demo workflow: offers are stored in this browser. Connect authenticated trade APIs before using this for real transactions.</p></div></div>`);
}
function updateTradeOffer(id,status){
 const o=tradeOffers.find(x=>x.id===id);if(!o)return;o.status=status;saveTradeStore();document.getElementById("myTradeOffersModal")?.remove();showMyTradeOffers();toast("Offer marked "+status.toLowerCase()+".");
}
function counterTradeOffer(id){
 const o=tradeOffers.find(x=>x.id===id);if(!o)return;const counter=prompt("Enter your counteroffer or revised terms:",o.message||"");if(counter===null)return;o.message=(o.message?o.message+" | ":"")+"Counteroffer: "+counter;o.status="Countered";saveTradeStore();document.getElementById("myTradeOffersModal")?.remove();showMyTradeOffers();toast("Counteroffer saved.");
}

/* ============================= INIT ============================= */
renderMarketplaceBenefits();
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProductDetails();});
initializeProducts();
initializeOrders();
initializeMessages();