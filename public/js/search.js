document.addEventListener('DOMContentLoaded',()=>{
  const menuBtn=document.getElementById('btnCustomMenu'), menu=document.getElementById('customMobileMenu');
  const searchBtn=document.getElementById('btnCustomSearch'), box=document.getElementById('customSearchBox');
  const input=document.getElementById('myUniqueSearchInput'), results=document.getElementById('customSearchResults');
  if(!menuBtn||!menu||!searchBtn||!box||!input||!results) return;
  function close(){menu.classList.remove('show-menu');box.style.display='none';menuBtn.setAttribute('aria-expanded','false');searchBtn.setAttribute('aria-expanded','false');}
  menuBtn.onclick=e=>{e.stopPropagation();const open=!menu.classList.contains('show-menu');close();menu.classList.toggle('show-menu',open);menuBtn.setAttribute('aria-expanded',String(open));};
  searchBtn.onclick=e=>{e.stopPropagation();const open=box.style.display!=='block';close();box.style.display=open?'block':'none';searchBtn.setAttribute('aria-expanded',String(open));if(open)input.focus();};
  document.addEventListener('click',e=>{if(!document.getElementById('customNavbar')?.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const wasSearch=box.style.display==='block';close();(wasSearch?searchBtn:menuBtn).focus();}});
  let timer, controller, sequence=0;
  function message(text){results.replaceChildren();const node=document.createElement('p');node.style.cssText='padding:15px;color:#fff;text-align:center';node.textContent=text;results.append(node);}
  input.addEventListener('input',()=>{
    clearTimeout(timer);controller?.abort();const request=++sequence,q=input.value.trim().slice(0,80);
    if(q.length<2){results.replaceChildren();return;}
    message('Searching…');
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try {
        const response=await fetch('/api/search?q='+encodeURIComponent(q),{signal:controller.signal});
        if(!response.ok)throw new Error('Search unavailable');
        const data=await response.json();if(request!==sequence)return;
        if(!data.products?.length){message('No bracelets found. Try another name.');return;}
        results.replaceChildren();
        for(const product of data.products){
          const row=document.createElement('div');row.className='new-search-item';
          const link=document.createElement('a');link.href='/product/'+encodeURIComponent(product.slug);
          const img=document.createElement('img');img.alt='';img.width=48;img.height=48;
          if(product.main_image && /^(\/(?!\/)|https?:\/\/)/.test(product.main_image))img.src=product.main_image;
          img.addEventListener('error',()=>img.remove(),{once:true});
          const text=document.createElement('div'),name=document.createElement('span'),price=document.createElement('span');
          text.style.cssText='display:flex;flex-direction:column;justify-content:center';name.textContent=product.name;
          name.style.cssText='font-weight:600;font-size:.9rem';price.textContent='₹'+Number(product.price).toLocaleString('en-IN');
          text.append(name,price);link.append(img,text);row.append(link);results.append(row);
        }
      } catch(err){if(err.name!=='AbortError'&&request===sequence)message('Search is unavailable. Please try again.');}
    },250);
  });
});
