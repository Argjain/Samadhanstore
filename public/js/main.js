function escapeHTML(value){return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Samadhan V3 — Main JS

// 1. GLOBAL IMAGE ERROR HANDLER (CSP SAFE)
// This will automatically hide any image that fails to load without using an 'onerror' attribute.
document.addEventListener('error', function(event) {
  if (event.target.tagName && event.target.tagName.toLowerCase() === 'img') {
    event.target.style.display = 'none';
    
    if (event.target.classList.contains('hide-next-error') && event.target.nextElementSibling) {
      event.target.nextElementSibling.style.display = 'none';
    }
  }
}, true); // 'true' is required to capture the event before it bubbles

document.addEventListener('DOMContentLoaded', function(){

  // Particles
  const pc=document.getElementById('particles');
  if(pc){for(let i=0;i<20;i++){const p=document.createElement('div');p.className='particle';p.style.cssText=`left:${Math.random()*100}%;width:${Math.random()*2.5+1}px;height:${Math.random()*2.5+1}px;animation-duration:${Math.random()*14+10}s;animation-delay:${Math.random()*14}s`;pc.appendChild(p);}}

// Navbar scroll (Smart Hide/Show) - 100% HIDE FIX
  const nav=document.getElementById('navbar');
  if(nav) {
    let lastScroll = 0;
    // Made the animation a bit smoother
    nav.style.transition = 'transform 0.4s ease-in-out, background 0.3s ease, box-shadow 0.3s ease';
    
    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;
      
      if (currentScroll > lastScroll && currentScroll > 80) {
        // Set to -170% so the navbar fully hides even if there's a gap
        nav.style.transform = 'translateY(-170%)';
      } else {
        // Return to normal position when scrolling up
        nav.style.transform = 'translateY(0)';
      }
      
      nav.classList.toggle('scrolled', currentScroll > 60);
      lastScroll = currentScroll;
    }, {passive:true});
  }
        // Mobile nav
  const toggle=document.getElementById('navToggle'),links=document.getElementById('navLinks');
  if(toggle&&links){
    toggle.addEventListener('click',()=>{links.classList.toggle('open');toggle.classList.toggle('open');});
    document.addEventListener('click',e=>{if(nav&&!nav.contains(e.target)){links.classList.remove('open');toggle.classList.remove('open');}});
  }

  // Search toggle
  const st=document.getElementById('searchToggle'),sd=document.getElementById('searchDropdown'),si=document.getElementById('searchInput');
  if(st&&sd){
    st.addEventListener('click',e=>{e.stopPropagation();sd.classList.toggle('open');if(sd.classList.contains('open'))si?.focus();});
    document.addEventListener('click',e=>{if(!sd.contains(e.target)&&e.target!==st)sd.classList.remove('open');});
  }

  // Scroll reveal
  const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});},{threshold:.1});
  document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));

  // Flash dismiss
  const flash=document.getElementById('flashMsg');
  if(flash)setTimeout(()=>{flash.style.opacity='0';flash.style.transition='opacity .5s';setTimeout(()=>flash.remove(),500);},3500);

  // Add to cart
  document.querySelectorAll('.btn-add-cart, .btn-cart').forEach(btn=>{
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click',async function(e){
      e.preventDefault();
      const pid=this.dataset.productId;
      const qty=document.getElementById('qty')?.value||1;
      if(!pid)return;
      const orig=this.textContent;
      this.disabled=true;
      try{
        const r=await fetch('/cart/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:pid,qty:parseInt(qty)})});
        const d=await r.json();
        if(d.success){
          this.textContent='✓ Added!';this.classList.add('added');
          showToast('✦ '+d.message);
          // Update Flipkart-style cart badge
          const badge = document.getElementById('navCartBadge');
          if(badge && d.cartCount > 0){
            badge.textContent = d.cartCount;
            badge.style.display = 'flex';
            // Re-trigger pop animation
            badge.style.animation = 'none';
            badge.offsetHeight; // reflow
            badge.style.animation = 'badgePop 0.3s cubic-bezier(0.36,0.07,0.19,0.97)';
          }
          setTimeout(()=>{this.textContent=orig;this.classList.remove('added');this.disabled=false;},2000);
        }else this.disabled=false;
      }catch(e){this.disabled=false;}
    });
  });

  // Add Combo to cart
  document.querySelectorAll('.btn-add-combo').forEach(btn=>{
    btn.addEventListener('click',async function(e){
      e.preventDefault();
      const comboId=this.dataset.comboId;
      if(!comboId)return;
      const orig=this.textContent;
      this.disabled=true;
      try{
        const r=await fetch('/cart/add-combo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comboId:parseInt(comboId)})});
        const d=await r.json();
        if(d.success){
          this.textContent='✓ Added!';this.classList.add('added');
          showToast('✦ '+d.message);
          const badge = document.getElementById('navCartBadge');
          if(badge && d.cartCount > 0){
            badge.textContent = d.cartCount;
            badge.style.display = 'flex';
            badge.style.animation = 'none';
            badge.offsetHeight;
            badge.style.animation = 'badgePop 0.3s cubic-bezier(0.36,0.07,0.19,0.97)';
          }
          setTimeout(()=>{this.textContent=orig;this.classList.remove('added');this.disabled=false;},2000);
        }else{showToast(d.message||'Combo unavailable');this.disabled=false;}
      }catch(e){this.disabled=false;}
    });
  });
  const buyNowModal = document.getElementById('buyNowModal');
  const qtyInput = document.getElementById('qty');
  const displayPrice = document.getElementById('displayPrice');
  
  if(displayPrice && qtyInput) {
    const regularPrice = Number(displayPrice.dataset.regular || 0);
    const comboQty = Number(displayPrice.dataset.comboQty || 0);
    const comboPrice = Number(displayPrice.dataset.comboPrice || 0);
    
    function updatePriceDisplay() {
      let q = Math.min(Number(qtyInput.max)||10,Math.max(1,parseInt(qtyInput.value)||1));
      qtyInput.value=q;
      let currentUnitPrice = (comboQty > 0 && q >= comboQty) ? comboPrice : regularPrice;
      displayPrice.textContent = '₹' + currentUnitPrice.toLocaleString('en-IN');
      const total=document.getElementById('purchaseTotal');if(total)total.textContent='Total: ₹'+(currentUnitPrice*q).toLocaleString('en-IN')+' for '+q+' item'+(q===1?'':'s');
    }
    
    qtyInput.addEventListener('change', updatePriceDisplay);
    qtyInput.addEventListener('input', updatePriceDisplay);
    updatePriceDisplay();
  }

  const btnBuyNow = document.getElementById('btnBuyNow');
  if(btnBuyNow) {
    btnBuyNow.addEventListener('click', async function(e) {
      e.preventDefault();
      const pid = this.dataset.productId;
      const q = parseInt(qtyInput?.value || 1);
      
      try {
        const r = await fetch('/cart/buy-now', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ productId: pid, qty: q })
        });
        const d = await r.json();
        if(d.success) {
          window.location.href = '/cart/buy-now-summary';
        } else {
          showToast('Error adding item');
        }
      } catch(err) {
        showToast('Connection error');
      }
    });
  }

  // Qty buttons
  const qtyEl=document.getElementById('qty');
  document.querySelectorAll('[onclick*="changeQty"]').length||document.querySelectorAll('.qty-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{if(!qtyEl)return;qtyEl.value=Math.min(10,Math.max(1,parseInt(qtyEl.value)+(btn.dataset.action==='inc'?1:-1)));});
  });

  // Cart qty update
  document.querySelectorAll('.cart-qty-input').forEach(inp=>{
    inp.addEventListener('change',async function(){
      const r=await fetch('/cart/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:this.dataset.productId,qty:this.value})});
      const d=await r.json();if(d.success)location.reload();
    });
  });

  // Remove from cart
  document.querySelectorAll('.remove-btn').forEach(btn=>{
    btn.addEventListener('click',async function(){
      const r=await fetch('/cart/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:this.dataset.productId})});
      const d=await r.json();if(d.success)location.reload();
    });
  });

  // Wishlist toggle
  document.querySelectorAll('.wishlist-btn').forEach(btn=>{
    btn.addEventListener('click',async function(e){
      e.preventDefault();e.stopPropagation();
      const pid=this.dataset.productId;
      const r=await fetch('/wishlist/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:pid})});
      const d=await r.json();
      if(d.success){
        this.classList.toggle('active',d.added);
        this.textContent=d.added?'❤️':'🤍';
        showToast(d.message);
      }
    });
  });

  // Product image gallery dots
  document.querySelectorAll('.product-card').forEach(card=>{
    const imgs=card.querySelectorAll('.img-dot');
    const mainImg=card.querySelector('.product-imgs img');
    if(!imgs.length||!mainImg)return;
    const srcs=Array.from(imgs).map((_,i)=>mainImg.getAttribute('src'));
    card.addEventListener('mouseenter',()=>{let i=0;card._timer=setInterval(()=>{i=(i+1)%imgs.length;imgs.forEach((d,j)=>d.classList.toggle('active',j===i));},1500);});
    card.addEventListener('mouseleave',()=>{clearInterval(card._timer);imgs[0]?.classList.add('active');});
  });

  // Quiz
  initQuiz();
});

// Toast
window.showToast=function(msg){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
};

// Quiz System
function initQuiz(){
  const container=document.getElementById('quizContainer');
  if(!container)return;
  const products = window.QUIZ_PRODUCTS || [];
  if(!products.length) { container.innerHTML='<p style="text-align:center;color:var(--text-muted);">Quiz loading...</p>'; return; }

  const questions=[
    {q:'What are you seeking in life right now?', options:['Wealth & Success','Love & Peace','Protection & Confidence','Health & Energy'], tags:['money,pyrite,wealth,success,business','rose,love,peace,healing','evil,protection,tiger,obsidian','chakra,health,rudraksha,energy']},
    {q:'How do you feel most days?', options:['Stressed about money','Lonely or anxious','Fearful or insecure','Tired or low energy'], tags:['money,wealth,pyrite','rose,love,healing','protection,evil,tiger','chakra,energy,rudraksha']},
    {q:'Which energy attracts you?', options:['Gold & Abundance','Pink & Gentle','Dark & Powerful','Multicolor & Balanced'], tags:['pyrite,gold,money','rose,quartz,love','obsidian,tiger,evil','chakra,navgrah,7']},
    {q:'What would you wear it for?', options:['Career & Business growth','Relationships & Harmony','Removing negativity','Overall wellbeing'], tags:['business,success,money,wealth','love,rose,healing','evil,protection,shanti','chakra,health,navgrah']},
  ];
  let cur=0; const answers=[];
  const fill=container.querySelector('.quiz-progress-fill');
  const step=container.querySelector('.quiz-step');
  const qEl=container.querySelector('.quiz-question');
  const oEl=container.querySelector('.quiz-options');

  function render(){
    const q=questions[cur];
    if(fill)fill.style.width=((cur/questions.length)*100)+'%';
    if(step)step.textContent='Question '+(cur+1)+' of '+questions.length;
    qEl.textContent=q.q; oEl.innerHTML='';
    q.options.forEach((opt,i)=>{
      const d=document.createElement('div'); d.className='quiz-option'; d.textContent=opt;
      d.addEventListener('click',()=>pick(i)); oEl.appendChild(d);
    });
  }
  function pick(i){
    oEl.querySelectorAll('.quiz-option').forEach(o=>o.classList.remove('selected'));
    oEl.querySelectorAll('.quiz-option')[i].classList.add('selected');
    answers.push(questions[cur].tags[i]);
    setTimeout(()=>{cur++;cur<questions.length?render():showResult();},400);
  }
  function showResult(){
    // Combine all selected tags and find best matching product
    const allTags = answers.join(',').toLowerCase().split(',');
    let bestProduct = products[0];
    let bestScore = 0;
    products.forEach(p => {
      const name = (p.name + ' ' + p.cat).toLowerCase();
      let score = 0;
      allTags.forEach(tag => { if(name.includes(tag.trim())) score++; });
      if(score > bestScore) { bestScore = score; bestProduct = p; }
    });
    if(fill)fill.style.width='100%';
    container.innerHTML='<div style="text-align:center;padding:30px 0"><div style="font-size:3rem;margin-bottom:16px">✨</div><h3 style="font-family:Cinzel,serif;font-size:1.6rem;color:var(--indigo);margin-bottom:10px">Your Perfect Match</h3><p style="color:var(--text-muted);margin-bottom:24px;font-style:italic">Based on your energy & intentions...</p><div style="font-family:Cinzel,serif;font-size:1.5rem;color:var(--lavender);margin-bottom:24px;">'+escapeHTML(bestProduct.name)+'</div><a href="/product/'+encodeURIComponent(bestProduct.slug)+'" class="btn-primary" style="display:inline-flex;padding:14px 32px;">View Bracelet →</a><br><a href="/shop" style="display:inline-block;margin-top:16px;color:var(--text-muted);font-size:.85rem;">Or browse all bracelets</a></div>';
    fetch('/api/quiz-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:allTags,productSlug:bestProduct.slug})}).catch(()=>{});
  }
  render();
}
