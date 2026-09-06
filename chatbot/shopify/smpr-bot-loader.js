(function(){
  var b64=(window.__SP1||'')+(window.__SP2||'')+(window.__SP3||'')+(window.__SP4||'');
  try{
    var bin=atob(b64), n=bin.length, bytes=new Uint8Array(n);
    for(var i=0;i<n;i++) bytes[i]=bin.charCodeAt(i);
    new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text()
      .then(function(code){ (0,eval)(code); })
      .catch(function(e){ document.body.innerHTML='<p style="padding:40px;font-family:sans-serif">Bot failed to load: '+e+'</p>'; });
  }catch(e){
    document.body.innerHTML='<p style="padding:40px;font-family:sans-serif">This test page needs a current browser (Safari 16.4+, Chrome, Edge or Firefox). '+e+'</p>';
  }
})();
