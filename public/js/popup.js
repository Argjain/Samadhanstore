// popup.js — Session-based with Full Fields (Name, Email, Phone, Pass, Cnf Pass)
(function () {
  'use strict';

  var loggedIn = document.body.getAttribute('data-loggedin');
  if (loggedIn === 'true') return;

  if (sessionStorage.getItem('sam_popup_shown') === '1') return;

  function showPopup() {
    sessionStorage.setItem('sam_popup_shown', '1');

    var overlay = document.createElement('div');
    overlay.id = 'authPopup';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(30,27,75,0.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity 0.4s ease;';

    overlay.innerHTML = `
      <div id="authPopupBox" style="background:#f5f0e8; border:1.5px solid rgba(30,27,75,0.12); border-radius:12px; width:100%; max-width:440px; padding:30px 32px; position:relative; box-shadow:0 20px 60px rgba(30,27,75,0.2); transform:translateY(20px); transition:transform 0.4s ease; text-align:center;">
        <button id="pCloseBtn" style="position:absolute; top:14px; right:16px; background:none; border:none; color:#7a7499; font-size:1.5rem; cursor:pointer; line-height:1;">✕</button>
        <div style="width:50px; height:50px; border-radius:50%; background:rgba(30,27,75,0.08); display:flex; align-items:center; justify-content:center; margin:0 auto 12px; font-size:1.5rem;">🪬</div>
        <h2 style="font-family:Cinzel,serif; font-size:1.3rem; color:#1e1b4b; margin-bottom:4px;">Welcome to Samadhan</h2>
        <p style="color:#7a7499; font-size:0.85rem; margin-bottom:15px;">Wear The Universe ✨</p>
        
        <div style="display:flex; border:1.5px solid rgba(30,27,75,0.15); border-radius:8px; overflow:hidden; margin-bottom:15px;">
          <button id="pTabLogin" style="flex:1; padding:8px; border:none; cursor:pointer; font-family:Cinzel,serif; font-size:0.7rem; background:#1e1b4b; color:#f5f0e8;">Login</button>
          <button id="pTabReg" style="flex:1; padding:8px; border:none; cursor:pointer; font-family:Cinzel,serif; font-size:0.7rem; background:transparent; color:#7a7499;">Register</button>
        </div>

        <!-- LOGIN FORM -->
        <div id="pFormLogin">
          <form action="/auth/login" method="POST">
            <input type="email" name="email" required placeholder="Email Address" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:9px; margin-bottom:10px; outline:none;">
            <input type="password" name="password" required placeholder="Password" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:9px; margin-bottom:15px; outline:none;">
            <button type="submit" style="width:100%; background:#1e1b4b; color:#f5f0e8; padding:11px; border:none; border-radius:8px; cursor:pointer; font-family:Cinzel,serif;">Login</button>
          </form>
          <p style="margin-top:12px; color:#7a7499; font-size:0.8rem;">New here? <a href="#" id="pLinkToReg" style="color:#1e1b4b; font-weight:bold;">Create an account</a></p>
        </div>

        <!-- REGISTER FORM (With all main fields) -->
        <div id="pFormReg" style="display:none;">
          <form action="/auth/register" method="POST">
            <input type="text" name="name" required placeholder="Full Name" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:8px; margin-bottom:8px;">
            <input type="email" name="email" required placeholder="Email" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:8px; margin-bottom:8px;">
            <input type="tel" name="phone" required placeholder="Phone Number" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:8px; margin-bottom:8px;">
            <input type="password" name="password" id="pRegPass" required placeholder="Password" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:8px; margin-bottom:8px;">
            <input type="password" name="confirm_password" id="pCnfPass" required placeholder="Confirm Password" style="width:100%; border:1.5px solid rgba(30,27,75,0.15); border-radius:6px; padding:8px; margin-bottom:12px;">
            <button type="submit" style="width:100%; background:#1e1b4b; color:#f5f0e8; padding:11px; border:none; border-radius:8px; cursor:pointer; font-family:Cinzel,serif;">Create Account 🎁</button>
          </form>
          <p style="margin-top:12px; color:#7a7499; font-size:0.8rem;">Already have an account? <a href="#" id="pLinkToLogin" style="color:#1e1b4b; font-weight:bold;">Login here</a></p>
        </div>
        <p style="margin-top:14px;"><a href="#" id="pSkipBtn" style="color:#c4bdd4; font-size:0.75rem;">Not now, maybe later</a></p>
      </div>`;

    document.body.appendChild(overlay);

    // Click Handlers (Event Listeners)
    const overlayRef = document.getElementById('authPopup');
    const boxRef = document.getElementById('authPopupBox');
    
    document.getElementById('pCloseBtn').onclick = document.getElementById('pSkipBtn').onclick = (e) => { e.preventDefault(); overlayRef.remove(); };
    overlayRef.onclick = (e) => { if(e.target === overlayRef) overlayRef.remove(); };

    const tabL = document.getElementById('pTabLogin'), tabR = document.getElementById('pTabReg');
    const formL = document.getElementById('pFormLogin'), formR = document.getElementById('pFormReg');

    const toggle = (to) => {
      if(to === 'l') {
        formL.style.display='block'; formR.style.display='none';
        tabL.style.background='#1e1b4b'; tabL.style.color='#f5f0e8';
        tabR.style.background='transparent'; tabR.style.color='#7a7499';
      } else {
        formL.style.display='none'; formR.style.display='block';
        tabR.style.background='#1e1b4b'; tabR.style.color='#f5f0e8';
        tabL.style.background='transparent'; tabL.style.color='#7a7499';
      }
    };

    tabL.onclick = document.getElementById('pLinkToLogin').onclick = (e) => { e.preventDefault(); toggle('l'); };
    tabR.onclick = document.getElementById('pLinkToReg').onclick = (e) => { e.preventDefault(); toggle('r'); };

    setTimeout(() => { overlay.style.opacity = '1'; boxRef.style.transform = 'translateY(0)'; }, 10);
  }

  setTimeout(showPopup, 10000); 
})();