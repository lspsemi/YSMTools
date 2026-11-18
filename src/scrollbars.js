// Auto-hiding scrollbars: style.css draws the thumb only on elements marked
// .is-scrolling (the root element for page scrolling), so it shows while a
// container scrolls and fades out shortly after it stops.
const HIDE_DELAY=900;
const timers=new WeakMap();

export function setupScrollbars(){
  document.addEventListener('scroll',event=>{
    const element=event.target===document?document.documentElement:event.target;
    if(!(element instanceof Element))return;
    element.classList.add('is-scrolling');
    clearTimeout(timers.get(element));
    timers.set(element,setTimeout(()=>element.classList.remove('is-scrolling'),HIDE_DELAY));
  },{capture:true,passive:true});
}
