/** @jest-environment jsdom */
const {renderTuOnboarding}=require('../tmp/frontend-test-modules/auth/tu-onboarding-view.cjs');
const registration=()=>({contract:'coed-tu-registration-v1',registrationToken:'SYNTHETIC_TICKET_NOT_FOR_DOM',expiresIn:300,
 identity:{subject:'9900000019',nameTh:'Synthetic Student <script>',email:'synthetic@example.invalid',faculty:'Science',department:'Computer Science',tuStatus:'ปกติ'}});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(options={}){const controller=new AbortController(),onSubmit=jest.fn(async()=>{}),onCancel=jest.fn();
 const root=renderTuOnboarding({registration:registration(),onSubmit,onCancel,signal:controller.signal,...options});document.body.replaceChildren(root);
 return {root,controller,onSubmit:options.onSubmit||onSubmit,onCancel,submit:()=>root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))};}
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));document.body.replaceChildren();});
test('shows immutable TU identity as text, self-report labels, and only two inputs',()=>{
 const s=setup();expect(s.root.querySelectorAll('input,select')).toHaveLength(2);expect(s.root.textContent).toContain('ข้อมูลที่คุณกรอกเอง');
 expect(s.root.querySelector('script')).toBeNull();expect(s.root.innerHTML).not.toContain('SYNTHETIC_TICKET_NOT_FOR_DOM');s.controller.abort();
});
test('empty submit retains inline errors and focuses a linked summary without making a request',async()=>{
 const s=setup();s.submit();await flush();expect(s.onSubmit).not.toHaveBeenCalled();expect(s.root.querySelectorAll('[aria-invalid=true]')).toHaveLength(2);
 const summary=s.root.querySelector('[role=alert]');expect(document.activeElement).toBe(summary);expect(summary.querySelectorAll('a')).toHaveLength(2);s.controller.abort();
});
test('network retry preserves operation ID and values, with no persistent ticket storage',async()=>{
 const s=setup({onSubmit:jest.fn().mockRejectedValue(Error('Retry'))});s.root.querySelector('select').value='regular';s.root.querySelector('input').value='2567';
 s.submit();await flush();s.submit();await flush();
 expect(s.onSubmit).toHaveBeenCalledTimes(2);expect(s.onSubmit.mock.calls[0][0].operationId).toBe(s.onSubmit.mock.calls[1][0].operationId);
 // Inspecting the request is allowed in this synthetic test; production never logs it.
 expect(s.root.textContent).toContain('Retry');expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0);
 expect(s.root.querySelector('input').value).toBe('2567');s.controller.abort();
});
test('expiry prevents creation and cancel offers a clear route back',async()=>{
 let now=0;const s=setup({clock:()=>now});now=300001;s.root.querySelector('select').value='special';s.root.querySelector('input').value='2567';s.submit();await flush();
 expect(s.onSubmit).not.toHaveBeenCalled();expect(s.root.textContent).toContain('หมดเวลาลงทะเบียน');s.root.querySelector('button[type=button]').click();expect(s.onCancel).toHaveBeenCalled();s.controller.abort();
});
