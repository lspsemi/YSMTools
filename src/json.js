// The game reads pack JSON with Gson's lenient JsonParser, which accepts raw
// control characters (e.g. a multi-line Molang script) inside strings and a
// leading BOM. Strict JSON.parse is tried first; on failure those characters
// are escaped and the text is parsed again. Kept self-contained so the worker
// in viewer.js can embed it via toString().
export function parseLenientJson(text){
  try{return JSON.parse(text);}
  catch(error){
    let out='',inString=false,escaped=false;
    for(const ch of String(text).replace(/^\uFEFF/,'')){
      if(inString){
        if(escaped)escaped=false;
        else if(ch==='\\')escaped=true;
        else if(ch==='"')inString=false;
        else if(ch<' '){out+=ch==='\n'?'\\n':ch==='\r'?'\\r':ch==='\t'?'\\t':`\\u${ch.charCodeAt(0).toString(16).padStart(4,'0')}`;continue;}
      }else if(ch==='"')inString=true;
      out+=ch;
    }
    try{return JSON.parse(out);}catch{throw error;}
  }
}
