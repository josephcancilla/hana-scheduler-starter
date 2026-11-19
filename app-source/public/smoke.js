// Slow-moving smoke overlay, ported from hana.events (axis-effects "smoke" concept).
// Runs on desktop AND phones (Joseph 2026-08-28); reduced-motion users keep the CSS glow fallback.
(function () {
  try {
    if (/[?&]embed=1/.test(location.search)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (navigator.connection && navigator.connection.saveData) return;

    var canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "4",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 2s ease",
      mixBlendMode: "screen",
    });
    var gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) return;

    var FRAG = [
      "precision mediump float;",
      "uniform float u_time;",
      "uniform vec2  u_res;",
      "uniform float u_intensity;",
      "const vec3 GARNET  = vec3(0.478, 0.106, 0.106);",
      "const vec3 CRIMSON = vec3(0.839, 0.188, 0.153);",
      "const vec3 EMBER   = vec3(0.910, 0.314, 0.271);",
      "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }",
      "float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);",
      "  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y); }",
      "float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }",
      "void main(){",
      "  vec2 uv = gl_FragCoord.xy / u_res;",
      "  vec2 p = uv * vec2(u_res.x/u_res.y, 1.0);",
      "  float t = u_time * 0.032;",
      "  float n1 = fbm(p*1.6 + vec2(t*0.6, -t*0.35));",
      "  float n2 = fbm(p*2.2 - vec2(t*0.42, t*0.5) + n1*1.2);",
      "  float smoke = smoothstep(0.42, 0.85, n2) * smoothstep(0.25, 0.65, n1);",
      "  float core = smoothstep(0.62, 0.95, n1*n2*1.8);",
      "  float fall = smoothstep(1.3, 0.05, uv.y);",
      "  vec3 col = GARNET * smoke * 1.1 + CRIMSON * core * 0.9;",
      "  vec2 ep = vec2(p.x*3.0, p.y*3.0 - u_time*0.05);",
      "  vec2 cell = floor(ep); float r = hash(cell);",
      "  if (r > 0.997) {",
      "    vec2 lp = fract(ep) - 0.5;",
      "    float d = length(lp + vec2(sin(u_time*0.3+r*40.)*0.2, 0.));",
      "    float glow = smoothstep(0.12, 0.0, d);",
      "    col += EMBER * glow * (0.55 + 0.45*sin(u_time*0.7 + r*80.));",
      "  }",
      "  col *= fall;",
      "  col *= u_intensity;",
      "  gl_FragColor = vec4(col, 1.0);",
      "}",
    ].join("\n");
    var VERT = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, "u_time");
    var uRes = gl.getUniformLocation(prog, "u_res");
    var uInt = gl.getUniformLocation(prog, "u_intensity");

    var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      var w = Math.floor(window.innerWidth * DPR * 0.5);
      var h = Math.floor(window.innerHeight * DPR * 0.5);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    document.body.prepend(canvas);
    document.documentElement.classList.add("axis-fx-live");
    requestAnimationFrame(function () {
      canvas.style.opacity = "1";
    });

    var start = performance.now();
    // Degrade guard: sustained jank kills the effect, CSS glow returns.
    var slow = 0;
    var last = start;
    function frame(now) {
      var dt = now - last;
      last = now;
      if (dt > 80) {
        if (++slow > 60) {
          canvas.remove();
          document.documentElement.classList.remove("axis-fx-live");
          return;
        }
      } else if (slow > 0) slow--;
      resize();
      var scrollFrac = (window.scrollY || 0) / (window.innerHeight || 1);
      var intensity = 0.5 * Math.max(0.6, 1 - scrollFrac * 0.3);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uInt, intensity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (e) {
    /* fail soft: CSS fallback glow stays */
  }
})();
