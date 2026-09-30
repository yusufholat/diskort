// "Yığılmış alfa" videosunun birleştiricisi (önizleme sayfası ve oynatma doğrulaması kullanır). Video tek ve
// opaktır: bir yarısında alfayla çarpılmış renk, öteki yarısında alfa (gri) durur (yerleşim: video.mjs
// stackedLayout). Bu küçük, sabit gölgelendirici iki yarıyı tek alfalı görüntüde birleştirir: çözücüden alfa
// desteği gerekmez. Tuval videonun bir yarısıyla aynı boyuttadır (piksel piksele, süzme yok).
(function () {
  const VS = 'attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  // c: renk yarısının, m: alfa yarısının doku dikdörtgeni (x, y, genişlik, yükseklik). Renk zaten alfayla
  // çarpılmış; sıkıştırma hatası rengi alfanın üstüne taşırsa kırpılır (saydam yerde parlama olmasın).
  const FS =
    'precision mediump float;uniform sampler2D t;uniform vec4 c;uniform vec4 m;varying vec2 v;' +
    'void main(){float a=texture2D(t,m.xy+v*m.zw).g;gl_FragColor=vec4(min(texture2D(t,c.xy+v*c.zw).rgb,vec3(a)),a);}';

  /** Tuvali hazırlar; dönen draw(video) videonun o anki karesini birleştirip çizer */
  function create(canvas, layout) {
    canvas.width = layout.tileW;
    canvas.height = layout.tileH;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL kullanılamıyor');
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('gölgelendirici derlenemedi: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program bağlanamadı: ' + gl.getProgramInfoLog(p));
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const sx = layout.tileW / layout.width;
    const sy = layout.tileH / layout.height;
    gl.uniform4f(gl.getUniformLocation(p, 'c'), layout.colorX / layout.width, 0, sx, sy);
    gl.uniform4f(gl.getUniformLocation(p, 'm'), layout.alphaX / layout.width, 0, sx, sy);
    gl.viewport(0, 0, layout.tileW, layout.tileH);
    gl.disable(gl.BLEND);
    return {
      gl,
      draw(video) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  /** Oynayan videonun her yeni karesini tuvale çizer; dönen işlev durdurur */
  function attach(video, canvas, layout) {
    const player = create(canvas, layout);
    let stopped = false;
    const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
    const tick = () => {
      if (stopped) return;
      if (video.readyState >= 2) player.draw(video);
      if (hasRvfc) video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stopped = true;
    };
  }

  window.StackedAlpha = { create, attach };
})();
