// Integration tests use a disposable LOCAL MySQL database and a fake payment gateway.
// They never load the production .env or send real payments, emails or SMS.
const {test,before,after,beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DOTENV_CONFIG_PATH = path.join(__dirname,'no-production-env');
Object.assign(process.env,{NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_PORT:process.env.TEST_MYSQL_PORT || '33317',DB_USER:'root',DB_PASS:'',DB_NAME:'samadhan_security_test',
  SESSION_SECRET:'test-only-session-secret-0123456789',RAZORPAY_KEY_ID:'rzp_test_local',RAZORPAY_KEY_SECRET:'test-only-key',RAZORPAY_WEBHOOK_SECRET:'test-webhook-secret',
  FREE_SHIPPING_ABOVE:'599',SHIPPING_CHARGE:'29',ONLINE_PAYMENT_DISCOUNT:'5',GST_PERCENT:'0',MAIL_USER:'',MAIL_PASS:'',FAST2SMS_KEY:'',
  UPLOAD_DIR:path.join(__dirname,'tmp-uploads'),SITE_URL:'http://127.0.0.1'});
const mysql = require('mysql2/promise');
require('dotenv').config = () => ({parsed:{}});
let db,checkout,pricing,app,server,url,config,category;
let remoteOrders,remotePayments,nextRemote;
const delivery={name:'Test Buyer',email:'buyer@example.test',phone:'9999999999',address:'123 Test Street',city:'Delhi',state:'Delhi',pincode:'110001'};
function browser() {
  let cookie='';
  return async function request(route,body,method=body?'POST':'GET',extra={}) {
    const headers={...extra.headers}; if(cookie) headers.cookie=cookie;
    let data;
    if(body!==undefined) { headers['Content-Type']='application/x-www-form-urlencoded'; data=new URLSearchParams(body).toString(); }
    if(extra.json) {headers['Content-Type']='application/json';data=JSON.stringify(extra.json);}
    const r=await fetch(url+route,{method,headers,body:data,redirect:'manual'});
    const setCookie=r.headers.get('set-cookie'); if(setCookie) cookie=setCookie.split(';')[0];
    const text=await r.text();return {status:r.status,text,location:r.headers.get('location'),headers:r.headers,json:()=>JSON.parse(text)};
  };
}
async function fixture(request,{admin=false,userId=null,qty=1,buyNow=false,code=null}={}) {
  await request('/__fixture',undefined,'POST',{json:{admin,userId,qty,buyNow,code}});
  const page=await request('/orders/checkout'+(buyNow?'?buyNow=true':''));
  assert.equal(page.status,200,page.text);
  for (const script of page.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new (require('node:vm').Script)(script[1]);
  const token=page.text.match(/name="checkoutToken" value="([^"]+)"/)[1];
  return {token,page};
}
async function initiate(request,token,extra={}) {
  return request('/orders/razorpay-initiate',undefined,'POST',{json:{...delivery,checkoutToken:token,expectedTotal:950,...extra}});
}
function payment(remote,status='captured',extra={}) {
  const p={id:'pay_'+String(remotePayments.size+1),order_id:remote.id,amount:remote.amount,currency:'INR',status,amount_refunded:0,...extra};
  remotePayments.set(p.id,p); return p;
}
function callback(token,p,extra={}) {
  return {checkoutToken:token,razorpay_order_id:p.order_id,razorpay_payment_id:p.id,
    razorpay_signature:crypto.createHmac('sha256',config.razorpay.keySecret).update(p.order_id+'|'+p.id).digest('hex'),...extra};
}
async function stock() { const [[r]]=await db.query('SELECT stock FROM products WHERE id=1');return r.stock; }
async function orderCount() {const [[r]]=await db.query('SELECT COUNT(*) AS n FROM orders');return r.n;}
before(async()=>{
  const bootstrap=await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.DB_PORT),user:'root',password:''});
  await bootstrap.query('CREATE DATABASE IF NOT EXISTS samadhan_security_test CHARACTER SET utf8mb4');await bootstrap.end();
  config=require('../config/app');db=require('../config/db');
  const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.equal(identity.name,'samadhan_security_test');
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  const [existing]=await db.query('SHOW TABLES');for(const row of existing) await db.query('DROP TABLE ??',[Object.values(row)[0]]);
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  const setup=fs.readFileSync(path.join(__dirname,'../config/setupDB.js'),'utf8');
  for(const match of setup.matchAll(/`(CREATE TABLE IF NOT EXISTS [\s\S]*?)`/g)) {
    let sql=match[1];
    if(sql.startsWith('CREATE TABLE IF NOT EXISTS products')) sql=sql.replace(/category_id\s+INT,/, 'category_id VARCHAR(200),').replace(/,\s*FOREIGN KEY \(category_id\) REFERENCES categories\(id\) ON DELETE SET NULL/,'');
    await db.query(sql);
  }
  await db.query('ALTER TABLE products ADD COLUMN combo_qty INT DEFAULT 0, ADD COLUMN combo_price DECIMAL(10,2) DEFAULT 0, ADD COLUMN planet VARCHAR(200), ADD COLUMN mulank VARCHAR(200), ADD COLUMN zodiac VARCHAR(200)');
  await db.query('ALTER TABLE banners ADD COLUMN image VARCHAR(300)');
  await db.query('CREATE TABLE blogs (id INT PRIMARY KEY AUTO_INCREMENT,title VARCHAR(200),slug VARCHAR(200),content TEXT,excerpt TEXT,image VARCHAR(300),tags VARCHAR(200),author VARCHAR(100),is_published TINYINT DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE combo_deals (id INT PRIMARY KEY AUTO_INCREMENT,title VARCHAR(200),combo_price DECIMAL(10,2),is_active TINYINT DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
  await db.query('CREATE TABLE combo_deal_items (combo_deal_id INT,product_id INT) ENGINE=InnoDB');
  await require('../config/migrate')();await require('../config/migrate')();
  checkout=require('../services/checkout');pricing=require('../services/pricing');category=require('../models/Category');
  const gateway=checkout.client();
  gateway.orders.create=async o=>{const remote={...o,id:'order_'+(++nextRemote)};remoteOrders.set(remote.id,remote);return remote;};
  gateway.payments.fetch=async id=>{if(!remotePayments.has(id)) throw new Error('Missing fake payment');return remotePayments.get(id);};
  gateway.orders.fetchPayments=async id=>({items:[...remotePayments.values()].filter(p=>p.order_id===id)});
  const express=require('express');app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../views'));
  app.post('/orders/razorpay-webhook',express.raw({type:'application/json'}),require('../routes/paymentWebhook'));
  app.use(express.urlencoded({extended:true}));app.use(express.json());
  app.use(require('method-override')(require('../middlewares/formMethod')));
  app.use(require('express-session')({secret:config.session.secret,resave:false,saveUninitialized:false}));app.use(require('connect-flash')());
  Object.assign(app.locals,require('../services/contentSafety'),{imageUrl:require('../services/images').imageUrl});
  app.use((req,res,next)=>{Object.assign(res.locals,{S:{},config,site:config.site,business:config.business,categories:[],banners:[],festivalOffer:null,currentUser:req.session.user||null,isAdmin:!!req.session.isAdmin,cartCount:0,wishlistIds:[],success:req.flash('success'),error:req.flash('error'),path:req.path});next();});
  app.post('/__fixture',(req,res)=>{const {admin,userId,qty,buyNow,code}=req.body;req.session.isAdmin=admin;req.session.user=userId?{id:userId,name:'Test User',email:'buyer@example.test'}:null;
    req.session[buyNow?'buyNowCart':'cart']={'1':{id:1,qty,price:1,name:'Stale Name'}};
    req.session[buyNow?'buyNowCoupon':'coupon']=code;res.json({ok:true});});
  app.use('/cart',require('../routes/cart'));app.use('/orders',require('../routes/order'));app.use('/admin',require('../routes/admin'));app.use('/auth',require('../routes/auth'));
  app.use('/wishlist',require('../routes/wishlist'));
  app.use('/reviews',require('../routes/reviews'));app.use('/api',require('../routes/api'));app.use('/',require('../routes/shop'));
  app.get('/__secure',require('../middlewares/sessionSecurity'),(req,res)=>res.json({user:req.session.user||null,admin:!!req.session.isAdmin}));
  app.use((err,req,res,next)=>res.status(err.status||500).json({success:false,error:err.code||err.message}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});url='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
  remoteOrders=new Map();remotePayments=new Map();nextRemote=0;
  for(const table of ['user_security','blogs','secure_checkouts','orders','wishlist','reviews','combo_deal_items','combo_deals','products','categories','coupons','users','site_settings']) await db.query('DELETE FROM ??',[table]);
  await db.query("INSERT INTO categories (id,name,slug) VALUES (1,'Original','original')");
  await db.query("INSERT INTO products (id,name,slug,price,stock,is_active,images,category_id) VALUES (1,'Test Bracelet','test-bracelet',1000,5,1,'[\"/uploads/products/existing.jpg\"]',1)");
  await db.query("INSERT INTO users (id,name,email,password) VALUES (1,'Owner','owner@example.test','unused'),(2,'Other','other@example.test','unused')");
});
after(async()=>{if(server) await new Promise(r=>server.close(r));if(db) await db.end();});
test('review API rejects out-of-range and malformed ratings without corrupting product pages',async()=>{
  const b=browser();await fixture(b,{userId:1});
  for(const rating of [-1,0,6,1.5,'5evil',{},null]) {
    const result=await b('/reviews/add',undefined,'POST',{json:{productId:1,rating,review:'Test review'}});assert.equal(result.status,400);
  }
  assert.equal((await b('/reviews/add',{productId:1,rating:5,review:'Good product'})).status,200);
  await db.query("INSERT INTO reviews (product_id,name,rating,is_approved) VALUES (1,'Legacy invalid',99,1)");
  assert.equal((await require('../models/User').Review.getByProduct(1)).length,0);
  const page=await b('/product/test-bracelet');assert.equal(page.status,200);assert.doesNotMatch(page.text,/Legacy invalid/);
});
test('blog sanitizer removes executable HTML on save and when reading legacy posts',async()=>{
  const Blog=require('../models/Blog'),payload='<h2>Keep heading</h2><p>Hello <strong>world</strong></p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="java&#115;cript:alert(1)">link</a><iframe src="https://evil.example"></iframe>';
  const id=await Blog.create({title:'Safe post',content:payload,is_published:true});
  let post=await Blog.getById(id);assert.match(post.content,/<strong>world<\/strong>/);assert.doesNotMatch(post.content,/script|onerror|iframe/i);
  await db.query('UPDATE blogs SET content=? WHERE id=?',[payload,id]);post=await Blog.getBySlug('safe-post');assert.doesNotMatch(post.content,/script|onerror|iframe/i);
});
test('reset tokens are hashed, one-use, and revoke existing customer and admin sessions',async()=>{
  const {User}=require('../models/User');
  await db.query("UPDATE users SET password=?,role='admin' WHERE id=1",[await require('bcryptjs').hash('OldPassword123!',10)]);
  const a=browser(),b=browser();
  for(const client of [a,b]) {await client('/auth/login',{email:'owner@example.test',password:'OldPassword123!'});assert.equal((await client('/__secure')).json().admin,true);}
  await User.saveResetToken('owner@example.test','secret-token',new Date(Date.now()+3600000).toISOString().slice(0,19).replace('T',' '));
  const [[row]]=await db.query('SELECT resetPasswordToken FROM users WHERE id=1');assert.match(row.resetPasswordToken,/^sha256:/);assert.ok(!row.resetPasswordToken.includes('secret-token'));
  const results=await Promise.all([User.updatePassword(1,'NewPassword123!','secret-token'),User.updatePassword(1,'NewPassword123!','secret-token')]);
  assert.deepEqual(results.sort(),[false,true]);assert.equal(await User.findByToken('secret-token'),null);
  for(const client of [a,b]) {const state=(await client('/__secure')).json();assert.equal(state.user,null);assert.equal(state.admin,false);}
  await a('/auth/login',{email:'owner@example.test',password:'NewPassword123!'});assert.equal((await a('/__secure')).json().admin,true);
});
test('forgot-password responses do not disclose whether an account exists',async()=>{
  const a=browser(),b=browser();
  const x=await a('/auth/forgot-password',{email:'owner@example.test'}),y=await b('/auth/forgot-password',{email:'missing@example.test'});
  assert.equal(x.status,y.status);assert.equal(x.location,y.location);
  const xp=await a(x.location),yp=await b(y.location);assert.equal(xp.text,yp.text);assert.match(xp.headers.get('cache-control'),/no-store/);
});
test('image conversion rejects forged MIME payloads and preserves original external files',async()=>{
  const images=require('../services/images'),sharp=require('sharp');
  for(const body of ['<html><script>alert(1)</script></html>','<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>']) await assert.rejects(images.decode(Buffer.from(body),480));
  const original=await sharp({create:{width:900,height:600,channels:3,background:'#765432'}}).png().toBuffer();
  const dir=path.join(config.upload.baseDir,'products');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'preserved.png');fs.writeFileSync(file,original);
  const variants=await Promise.all([images.variant('products','preserved.png',480),images.variant('products','preserved.png',480)]);
  assert.equal(variants[0],variants[1]);const meta=await sharp(variants[0]).metadata();assert.equal(meta.width,480);assert.equal(meta.format,'webp');assert.deepEqual(fs.readFileSync(file),original);
  const before=fs.statSync(variants[0]).mtimeMs;await images.variant('products','preserved.png',480);assert.equal(fs.statSync(variants[0]).mtimeMs,before);
  const newer=await sharp({create:{width:900,height:600,channels:3,background:'#123456'}}).png().toBuffer();fs.writeFileSync(file,newer);
  assert.notEqual(await images.variant('products','preserved.png',480),variants[0]);
});
test('public layout cache shares in-flight work, invalidates, and never retains rejected loads',async()=>{
  const cache=require('../services/layoutCache');cache.clear();let calls=0;
  const loader=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return ['settings'];};
  await Promise.all([cache.get(loader),cache.get(loader)]);await cache.get(loader);assert.equal(calls,1);
  cache.clear();await cache.get(loader);assert.equal(calls,2);cache.clear();await assert.rejects(cache.get(async()=>{throw new Error('DB unavailable');}));await cache.get(loader);assert.equal(calls,3);cache.clear();
});
test('search and product APIs cap result sizes and reject malformed query objects',async()=>{
  for(let i=2;i<=31;i++)await db.query('INSERT INTO products (id,name,slug,price,stock,is_active,category_id) VALUES (?,?,?,?,1,1,1)',[i,'Test product '+i,'test-'+i,i*10]);
  const b=browser();assert.equal((await b('/api/search?q=Test')).json().products.length,6);
  assert.equal((await b('/api/search?q[x]=oops')).json().products.length,0);
  const result=(await b('/api/products?limit=99999&offset=-1')).json();assert.equal(result.products.length,24);assert.equal(result.hasMore,true);
  const page=await b('/shop?category=original&search=Test&page=2');assert.equal(page.status,200);assert.match(page.text,/Page 2 of 2/);assert.match(page.text,/category=original&amp;search=Test&amp;page=1/);
});
test('combo display batches products into one query for several deals',async()=>{
  await db.query("INSERT INTO combo_deals (id,title,combo_price) VALUES (1,'One',900),(2,'Two',850)");await db.query('INSERT INTO combo_deal_items VALUES (1,1),(2,1)');
  const original=db.query;let calls=0;db.query=function(...args){calls++;return original.apply(this,args);};
  try {const deals=await require('../models/ComboDeals').getActiveDeals();assert.equal(deals.length,2);assert.equal(calls,2);assert.equal(deals[0].products.length,1);}finally{db.query=original;}
});
test('product purchase controls precede long descriptions and inline scripts remain valid',async()=>{
  await db.query('UPDATE products SET description=?,stock=0 WHERE id=1',['Long details '.repeat(500)]);
  const page=await browser()('/product/test-bracelet');assert.equal(page.status,200);assert.ok(page.text.indexOf('id="btnBuyNow"')<page.text.indexOf('<p>Long details'));
  assert.match(page.text,/id="btnBuyNow" disabled/);
  for(const script of page.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new (require('node:vm').Script)(script[1]);
  const home=await browser()('/');for(const script of home.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new (require('node:vm').Script)(script[1]);
});
test('quiz JSON cannot break out into an executable script',async()=>{
  await db.query('UPDATE products SET name=? WHERE id=1',['</script><script>alert("unsafe")</script>']);
  const page=await browser()('/quiz');assert.equal(page.status,200);assert.doesNotMatch(page.text,/<script>alert\("unsafe"\)/);
  for(const script of page.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new (require('node:vm').Script)(script[1]);
});
test('category edit body method override updates original row and preserves slug',async()=>{
  const b=browser();await fixture(b,{admin:true});
  const r=await b('/admin/categories/1',{_method:'PUT',name:'Updated category',icon:'💎',description:'Updated',sort_order:'2',is_active:'on'});
  assert.equal(r.status,302);assert.equal(r.location,'/admin/categories');
  const c=await category.getById(1);assert.equal(c.name,'Updated category');assert.equal(c.slug,'original');assert.equal(c.sort_order,2);
  const page=await b('/admin/categories');assert.equal(page.status,200);assert.match(page.text,/Category updated!/);
});
test('category query override supports deactivation and empty sort value',async()=>{
  const b=browser();await fixture(b,{admin:true});const r=await b('/admin/categories/1?_method=PUT',{name:'Renamed',sort_order:''});
  assert.equal(r.status,302);const c=await category.getById(1);assert.equal(c.is_active,0);assert.equal(c.sort_order,0);
});
test('duplicate category and invalid category data return visible errors without crashing',async()=>{
  const b=browser();await fixture(b,{admin:true});await b('/admin/categories',{name:'Original',is_active:'on'});
  assert.match((await b('/admin/categories')).text,/already exists/);
  await b('/admin/categories/1',{_method:'PUT',name:'x'.repeat(101),sort_order:'-1'});
  assert.match((await b('/admin/categories')).text,/too long/);assert.equal((await category.getById(1)).name,'Original');
});
test('category database rejection is caught and subsequent requests still work',async()=>{
  const original=category.update;category.update=async()=>{throw Object.assign(new Error('private SQL details'),{code:'ER_BAD_FIELD_ERROR'});};
  try {const b=browser();await fixture(b,{admin:true});const r=await b('/admin/categories/1',{_method:'PUT',name:'Updated'});assert.equal(r.status,302);
    const page=await b('/admin/categories');assert.equal(page.status,200);assert.match(page.text,/Could not save/);assert.doesNotMatch(page.text,/private SQL/);
  } finally {category.update=original;}
});
test('guest cannot edit categories',async()=>{assert.equal((await browser()('/admin/categories/1',{_method:'PUT',name:'Attack'})).status,403);assert.equal((await category.getById(1)).name,'Original');});
test('negative, fractional, excessive and malformed cart quantities are rejected',async()=>{
  const b=browser();for(const qty of [-1,1.5,999,'NaN','2x']) {const r=await b('/cart/add',{productId:'1',qty});assert.equal(r.status,400,r.text);}
  assert.equal((await b('/cart/buy-now',{productId:'1',qty:'6'})).status,400);
  assert.equal((await b('/cart/update',{productId:'999',qty:'1'})).status,400);
});
test('inactive products cannot be bought',async()=>{await db.query('UPDATE products SET is_active=0 WHERE id=1');assert.equal((await browser()('/cart/add',{productId:1,qty:1})).status,400);});
test('gateway amount ignores browser amount and refreshes stale session price',async()=>{
  const b=browser(),{token,page}=await fixture(b);assert.match(page.text,/950/);
  const r=await initiate(b,token,{amount:1});assert.equal(r.status,200,r.text);assert.equal(r.json().order.amount,95000);assert.equal(await stock(),4);
});
test('changed prices block checkout until customer reviews total',async()=>{
  const b=browser(),{token}=await fixture(b);await db.query('UPDATE products SET price=2000 WHERE id=1');
  assert.equal((await initiate(b,token)).status,400);assert.equal(remoteOrders.size,0);assert.equal(await stock(),5);
});
test('valid checkout cannot be initiated or completed from another session',async()=>{
  const b=browser(),{token}=await fixture(b);assert.equal((await initiate(browser(),token)).status,400);
  const r=await initiate(b,token);const p=payment(r.json().order);assert.equal((await browser()('/orders/place-online',callback(token,p))).status,400);assert.equal(await orderCount(),0);
});
test('concurrent initiate retries create one gateway order and reserve stock once',async()=>{
  const b=browser(),{token}=await fixture(b);const results=await Promise.all([initiate(b,token),initiate(b,token)]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(remoteOrders.size,1);assert.equal(await stock(),4);
});
test('underpayment, wrong currency, uncaptured and mismatched-order payments cannot mark order paid',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),remote=r.json().order;
  for(const changes of [{amount:100},{currency:'USD'},{status:'authorized'},{order_id:'order_other'}]) {
    const p=payment(remote,'captured',changes);const result=await b('/orders/place-online',callback(token,p));assert.equal(result.status,400,result.text);
  } assert.equal(await orderCount(),0);
});
test('invalid payment signature is rejected before finalization',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order);
  assert.equal((await b('/orders/place-online',callback(token,p,{razorpay_signature:'bad'}))).status,400);assert.equal(await orderCount(),0);
});
test('captured payment produces one paid order across simultaneous callbacks',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order);
  const results=await Promise.all([b('/orders/place-online',callback(token,p)),b('/orders/place-online',callback(token,p))]);
  assert.deepEqual(results.map(r=>r.status),[302,302]);assert.equal(results[0].location,results[1].location);assert.equal(await orderCount(),1);assert.equal(await stock(),4);
  const [[order]]=await db.query('SELECT * FROM orders');assert.equal(Number(order.total),950);assert.equal(order.payment_status,'paid');assert.equal(order.payment_id,p.id);
});
test('same receipt cannot pay for a new checkout',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order);await b('/orders/place-online',callback(token,p));
  const {token:next}=await fixture(b);await initiate(b,next);assert.equal((await b('/orders/place-online',callback(next,p))).status,400);assert.equal(await orderCount(),1);
});
test('simultaneous customers cannot reserve the same last unit',async()=>{
  await db.query('UPDATE products SET stock=1 WHERE id=1');const a=browser(),b=browser();const aa=await fixture(a),bb=await fixture(b);
  const results=await Promise.all([initiate(a,aa.token),initiate(b,bb.token)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(await stock(),0);
});
test('COD duplicate submissions are idempotent',async()=>{
  const b=browser(),{token}=await fixture(b);const body={...delivery,checkoutToken:token,expectedTotal:1000};
  const results=await Promise.all([b('/orders/place-cod',body),b('/orders/place-cod',body)]);assert.deepEqual(results.map(r=>r.status),[302,302]);assert.equal(await orderCount(),1);assert.equal(await stock(),4);
});
test('database order failure rolls stock and checkout back',async()=>{
  await db.query("CREATE TRIGGER reject_test_order BEFORE INSERT ON orders FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
  try {const b=browser(),{token}=await fixture(b);assert.equal((await b('/orders/place-cod',{...delivery,checkoutToken:token,expectedTotal:1000})).status,500);assert.equal(await stock(),5);assert.equal(await orderCount(),0);const [[r]]=await db.query('SELECT COUNT(*) n FROM secure_checkouts');assert.equal(r.n,0);}
  finally {await db.query('DROP TRIGGER reject_test_order');}
});
test('Buy Now coupon is charged correctly and ordinary cart coupon stays separate',async()=>{
  await db.query("INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES ('SAVE100','fixed',100,500,1)");
  await db.query("INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES ('OTHER','fixed',10,0,20)");
  const b=browser();await fixture(b,{code:'OTHER'});const {token}=await fixture(b,{buyNow:true,code:'SAVE100'});
  const r=await initiate(b,token,{isBuyNow:true,expectedTotal:850});assert.equal(r.status,200,r.text);assert.equal(r.json().order.amount,85000);
  const p=payment(r.json().order);assert.equal((await b('/orders/place-online',callback(token,p,{isBuyNow:'true'}))).status,302);
  const [[order]]=await db.query('SELECT * FROM orders');assert.equal(order.coupon_code,'SAVE100');assert.equal(Number(order.total),850);
});
test('coupon limits are atomic and expired checkout releases its coupon and stock',async()=>{
  await db.query("INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES ('LAST','fixed',100,500,1)");
  const a=browser(),b=browser(),aa=await fixture(a,{code:'LAST'}),bb=await fixture(b,{code:'LAST'});
  const results=await Promise.all([initiate(a,aa.token,{expectedTotal:850}),initiate(b,bb.token,{expectedTotal:850})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(await stock(),4);
  await db.query('UPDATE secure_checkouts SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)');await checkout.reconcile();assert.equal(await stock(),5);
  const [[c]]=await db.query("SELECT used_count FROM coupons WHERE code='LAST'");assert.equal(c.used_count,0);await checkout.reconcile();assert.equal(await stock(),5);
});
test('captured payment recovers without browser callback',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token);payment(r.json().order);await checkout.reconcile();
  assert.equal(await orderCount(),1);await checkout.reconcile();assert.equal(await orderCount(),1);
});
test('signed webhook completes once; forged signatures cannot complete',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order);
  const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:p}}});
  async function send(sig) {return fetch(url+'/orders/razorpay-webhook',{method:'POST',headers:{'Content-Type':'application/json','x-razorpay-signature':sig},body:raw});}
  assert.equal((await send('forged')).status,400);assert.equal(await orderCount(),0);
  const sig=crypto.createHmac('sha256',config.razorpay.webhookSecret).update(raw).digest('hex');assert.equal((await send(sig)).status,200);assert.equal((await send(sig)).status,200);assert.equal(await orderCount(),1);
});
test('late captured payment is recorded for review when stock is gone',async()=>{
  await db.query('UPDATE products SET stock=1 WHERE id=1');const b=browser(),{token}=await fixture(b);const r=await initiate(b,token);
  await db.query('UPDATE secure_checkouts SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)');await checkout.reconcile();
  await db.query('UPDATE products SET stock=0 WHERE id=1');payment(r.json().order);await checkout.reconcile();
  const row=await checkout.get(token.split('.')[0]);assert.equal(row.status,'review');assert.ok(row.payment_id);assert.equal(await orderCount(),0);assert.equal(await stock(),0);
});
test('order details require purchaser session, owner account, or secure guest token',async()=>{
  const b=browser(),{token}=await fixture(b,{userId:1});const r=await b('/orders/place-cod',{...delivery,checkoutToken:token,expectedTotal:1000});assert.equal(r.status,302);
  assert.equal((await b(r.location)).status,200);assert.equal((await browser()(r.location)).status,404);
  const [[raw]]=await db.query('SELECT * FROM orders');const urlPath='/orders/track/'+raw.order_id;
  const other=browser();await fixture(other,{userId:2});assert.equal((await other(urlPath)).status,404);
  const owner=browser();await fixture(owner,{userId:1});assert.equal((await owner(urlPath)).status,200);
  const guest=browser(),secure=require('../services/orderAccess').trackingUrl(raw),link=await guest(secure);assert.equal(link.status,302);assert.equal(link.location,urlPath);
  const view=await guest(urlPath);assert.equal(view.status,200);assert.match(view.headers.get('cache-control'),/no-store/);
});
test('reset password rejects short and malformed passwords',async()=>{
  await require('../models/User').User.saveResetToken('owner@example.test','test-token',new Date(Date.now()+3600000).toISOString().slice(0,19).replace('T',' '));
  const b=browser();const r=await b('/auth/reset-password/test-token',{password:'x',confirmPassword:'x'});assert.equal(r.status,302);
  const [[u]]=await db.query('SELECT password FROM users WHERE id=1');assert.equal(u.password,'unused');
  assert.ok(require('../middlewares/validate').validators.password({}));
});
test('wishlist renders stored image arrays successfully',async()=>{
  await db.query('INSERT INTO wishlist (user_id,product_id) VALUES (1,1)');const b=browser();await fixture(b,{userId:1});const r=await b('/wishlist');assert.equal(r.status,200,r.text);assert.match(r.text,/existing.jpg/);
});
test('all templates compile',()=>{
  const ejs=require('ejs');let count=0;
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(p.endsWith('.ejs')){ejs.compile(fs.readFileSync(p,'utf8'),{filename:p});count++;}}}
  walk(path.join(__dirname,'../views'));assert.ok(count>=44);
});
test('admin business settings preserve current environment prices, then apply saved changes consistently',async()=>{
  await db.query("INSERT INTO site_settings (key_name,value,type,group_name) VALUES ('free_shipping','999','number','shipping'),('shipping_charge','79','number','shipping'),('online_discount','5','number','payment'),('gst_percent','0','number','payment'),('promo_banner_active','1','boolean','marketing')");
  const settings=require('../models/Settings');let values=await settings.getAll();assert.equal(values.free_shipping,'599');assert.equal(values.shipping_charge,'29');
  const grouped=await settings.getGrouped();assert.equal(grouped.shipping.find(s=>s.key_name==='shipping_charge').value,'29');
  await settings.bulkUpdate({free_shipping:'2000',shipping_charge:'0',online_discount:'0',gst_percent:'10'});
  const b=browser(),{token}=await fixture(b);const q=await pricing.quote({'1':{id:1,qty:1}},null);assert.equal(q.shipping,0);assert.equal(q.onlineDiscount,0);assert.equal(q.gst,100);assert.equal(q.onlineTotal,1100);
  assert.equal((await initiate(b,token,{expectedTotal:1100})).json().order.amount,110000);
  values=await settings.getAll();assert.equal(values.free_shipping,'2000');assert.equal(values.promo_banner_active,'0');
});
test('invalid admin financial settings roll back without changing existing values',async()=>{
  const settings=require('../models/Settings');await assert.rejects(()=>settings.bulkUpdate({shipping_charge:'-1'}));
  const values=await settings.getAll();assert.equal(values.shipping_charge,'29');assert.equal(values.business_rules_source,undefined);
});
test('gateway failure rolls back reserved stock and coupon use',async()=>{
  await db.query("INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES ('SAVE','fixed',100,0,1)");
  const original=checkout.client().orders.create;checkout.client().orders.create=async()=>{throw new Error('gateway unavailable');};
  try {const b=browser(),{token}=await fixture(b,{code:'SAVE'});assert.equal((await initiate(b,token,{expectedTotal:850})).status,500);assert.equal(await stock(),5);const [[c]]=await db.query("SELECT used_count FROM coupons WHERE code='SAVE'");assert.equal(c.used_count,0);}
  finally {checkout.client().orders.create=original;}
});
test('authorized payment retains reservation until captured',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order,'authorized');
  await db.query('UPDATE secure_checkouts SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)');await checkout.reconcile();assert.equal(await stock(),4);assert.equal(await orderCount(),0);
  p.status='captured';await checkout.reconcile();assert.equal(await orderCount(),1);assert.equal(await stock(),4);
});
test('late capture can reacquire available stock and complete exactly once',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token);await db.query('UPDATE secure_checkouts SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)');await checkout.reconcile();assert.equal(await stock(),5);
  payment(r.json().order);await checkout.reconcile();assert.equal(await stock(),4);assert.equal(await orderCount(),1);await checkout.reconcile();assert.equal(await stock(),4);
});
test('payment reservation retries reject changed delivery details',async()=>{
  const b=browser(),{token}=await fixture(b);await initiate(b,token);assert.equal((await initiate(b,token,{address:'456 Different Street'})).status,400);assert.equal(remoteOrders.size,1);
});
test('secondary category filtering and review aggregates work with strict SQL mode',async()=>{
  await db.query("INSERT INTO categories (id,name,slug) VALUES (2,'Secondary','secondary')");
  await db.query("UPDATE products SET category_id='1,2' WHERE id=1");
  await db.query("INSERT INTO reviews (product_id,name,rating,is_approved) VALUES (1,'A',3,1),(1,'B',5,1),(1,'Hidden',1,0)");
  const products=await require('../models/Product').getAll({categorySlug:'secondary'});assert.equal(products.length,1);assert.equal(Number(products[0].avg_rating),4);assert.equal(products[0].review_count,2);
});
test('notification lease avoids duplicate mail and retries only the failed channel',async()=>{
  const b=browser(),{token}=await fixture(b);const r=await initiate(b,token),p=payment(r.json().order);
  const row=await checkout.complete(token.split('.')[0],p);
  const {Email,SMS}=require('../services/notify');const originalEmail=Email.sendOrderConfirm,originalSms=SMS.sendOrderConfirm;let emails=0,sms=0;
  Email.sendOrderConfirm=async()=>{emails++;return true;};SMS.sendOrderConfirm=async()=>{sms++;return sms>1;};
  try {await Promise.all([checkout.notify(row.order_id),checkout.notify(row.order_id)]);assert.equal(emails,1);assert.equal(sms,1);
    await db.query('UPDATE secure_checkouts SET notification_after=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[row.id]);
    await checkout.notify(row.order_id);assert.equal(emails,1);assert.equal(sms,2);const final=await checkout.get(row.id);assert.equal(final.email_notified,1);assert.equal(final.sms_notified,1);
  } finally {Email.sendOrderConfirm=originalEmail;SMS.sendOrderConfirm=originalSms;}
});
