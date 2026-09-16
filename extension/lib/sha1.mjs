// Pure-JS SHA1 (sync — crypto.subtle is async, unusable inside a synchronous
// injected function). Used for innerTube SAPISIDHASH Authorization headers.
export function sha1(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const n = utf8.length;
  const wordCount = (((n + 8) >> 6) + 1) * 16;
  const words = new Uint32Array(wordCount);
  for (let i = 0; i < n; i++) words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
  words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
  words[wordCount - 1] = n * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x, s) => (x << s) | (x >>> (32 - s));
  for (let i = 0; i < wordCount; i += 16) {
    for (let j = 0; j < 16; j++) w[j] = words[i + j];
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const hex = (x) => (x >>> 0).toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}
