// MAIN world, document_start: install directly, without inline scripts or chrome.* APIs.
// API compatibility based on ProgramRipper/BLiveWeb, src/index.user.ts (MIT),
// commit eaa6433945ebc20dae3a2443b167ea37fdfeb99d.
(() => {
    'use strict';
    if (location.hostname !== 'link.bilibili.com' || window.__bsuInstalled) return;
    Object.defineProperty(window, '__bsuInstalled', { value: '1.1.0' });

    const API = 'https://api.live.bilibili.com';
    const PERMISSION = '/xlive/app-blink/v1/live/GetWebLivePermission';
    const ADDRESS = '/xlive/app-blink/v1/live/FetchWebUpStreamAddr';
    const WEB_START = '/xlive/app-blink/v1/streaming/WebLiveCenterStartLive';
    const START = '/room/v1/Room/startLive';
    const nativeFetch = window.fetch;
    const xhrPrototype = window.XMLHttpRequest.prototype;
    const nativeOpen = xhrPrototype.open;
    const nativeSend = xhrPrototype.send;
    const nativeResponseText = Object.getOwnPropertyDescriptor(xhrPrototype, 'responseText');
    const nativeResponse = Object.getOwnPropertyDescriptor(xhrPrototype, 'response');
    const requests = new WeakMap();
    let roomId = '';

    // MD5 is required by the public legacy client API's request signature.
    function md5(text) {
        const source = new TextEncoder().encode(text);
        const bytes = new Uint8Array(Math.ceil((source.length + 9) / 64) * 64);
        bytes.set(source);
        bytes[source.length] = 0x80;
        const view = new DataView(bytes.buffer);
        view.setUint32(bytes.length - 8, source.length * 8, true);
        view.setUint32(bytes.length - 4, Math.floor(source.length / 0x20000000), true);
        const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
        const hash = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
        for (let offset = 0; offset < bytes.length; offset += 64) {
            let [a, b, c, d] = hash;
            for (let i = 0; i < 64; i++) {
                const round = i >>> 4;
                const f = round === 0 ? (b & c) | (~b & d)
                    : round === 1 ? (d & b) | (~d & c)
                    : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
                const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16
                    : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
                const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)
                    + view.getUint32(offset + word * 4, true)) | 0;
                const shift = shifts[round * 4 + i % 4];
                [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
            }
            [a, b, c, d].forEach((value, i) => { hash[i] = (hash[i] + value) | 0; });
        }
        return hash.map(word => [0, 8, 16, 24].map(shift =>
            ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
    }

    function classify(input, method) {
        const url = new URL(input, location.href);
        if (url.origin !== API) return null;
        method = method.toUpperCase();
        if (method === 'GET' && url.pathname === '/room/v1/Area/getMyChooseArea') {
            const id = url.searchParams.get('roomid');
            if (/^\d+$/.test(id || '')) roomId = id;
        }
        if (method === 'GET' && url.pathname === PERMISSION) return { kind: 'permission', url };
        if (method !== 'POST') return null;
        if (url.pathname === ADDRESS && roomId) {
            return { kind: 'address', url: new URL(
                API + '/live_stream/v1/StreamList/get_stream_by_roomId?room_id=' + roomId) };
        }
        if (url.pathname === WEB_START || url.pathname === START) return { kind: 'start', url };
        return null;
    }

    function startBody(query, body) {
        const params = new URLSearchParams(query);
        const supplied = body instanceof FormData ? body.entries() : new URLSearchParams(body || '');
        for (const [key, value] of supplied) params.set(key, value);
        const signed = new URLSearchParams({
            access_key: '', appkey: 'aae92bc66f3edfab',
            area_v2: params.get('area_v2') || '', build: '9343',
            csrf: params.get('csrf') || params.get('csrf_token') || '',
            csrf_token: params.get('csrf_token') || params.get('csrf') || '',
            platform: 'pc_link', room_id: params.get('room_id') || roomId,
            ts: Math.floor(Date.now() / 1000).toString()
        });
        signed.sort();
        signed.set('sign', md5(signed.toString() + 'af125a0d5279fd576c1b4418a3e8276d'));
        return signed;
    }

    function transform(data, kind) {
        if (!data || data.code !== 0 || !data.data || typeof data.data !== 'object') return data;
        if (kind === 'permission') {
            return { ...data, data: { ...data.data, allow_live: true, fans_threshold: 0 } };
        }
        if (kind === 'address' && data.data.rtmp) {
            const { rtmp, stream_line, ...rest } = data.data;
            return { ...data, data: { ...rest, addr: rtmp, line: stream_line } };
        }
        return data;
    }

    function transformText(raw, info) {
        if (!info || info.kind === 'start') return raw;
        if (info.raw === raw) return info.mapped;
        try {
            const mapped = JSON.stringify(transform(JSON.parse(raw), info.kind));
            info.raw = raw;
            info.mapped = mapped;
            return mapped;
        } catch { return raw; }
    }

    xhrPrototype.open = function (method, url, ...args) {
        const info = classify(url, method);
        const result = nativeOpen.call(this, info?.kind === 'address' ? 'GET' : method,
            info?.kind === 'address' ? info.url.href : info?.kind === 'start' ? API + START : url, ...args);
        requests.set(this, info);
        return result;
    };
    xhrPrototype.send = function (body) {
        const info = requests.get(this);
        if (info?.kind === 'address') body = null;
        if (info?.kind === 'start') {
            body = startBody(info.url.searchParams, body).toString();
            this.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        }
        return nativeSend.call(this, body);
    };
    Object.defineProperty(xhrPrototype, 'responseText', {
        ...nativeResponseText,
        get() { return transformText(nativeResponseText.get.call(this), requests.get(this)); }
    });
    Object.defineProperty(xhrPrototype, 'response', {
        ...nativeResponse,
        get() {
            const raw = nativeResponse.get.call(this);
            const info = requests.get(this);
            if (!info) return raw;
            if (this.responseType === 'json') {
                if (info.jsonRaw !== raw) {
                    info.jsonRaw = raw;
                    info.jsonMapped = transform(raw, info.kind);
                }
                return info.jsonMapped;
            }
            return typeof raw === 'string' ? transformText(raw, info) : raw;
        }
    });

    function mappedResponse(original, text) {
        const headers = new Headers(original.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        const result = new Response(text, { status: original.status, statusText: original.statusText, headers });
        for (const key of ['url', 'redirected', 'type']) {
            Object.defineProperty(result, key, { value: original[key] });
        }
        const clone = result.clone.bind(result);
        result.clone = () => mappedResponse(clone(), text);
        return result;
    }

    window.fetch = async function (input, init) {
        const inputUrl = input instanceof Request ? input.url : String(input);
        const method = init?.method || (input instanceof Request ? input.method : 'GET');
        const info = classify(inputUrl, method);
        if (!info) return nativeFetch.call(this, input, init);
        let request = input instanceof Request
            ? new Request(input, init) : new Request(new URL(inputUrl, location.href), init);
        if (info.kind === 'address' || info.kind === 'start') {
            const headers = new Headers(request.headers);
            const supplied = info.kind === 'start'
                ? request.headers.get('content-type')?.startsWith('multipart/form-data')
                    ? await request.formData() : await request.text()
                : null;
            const body = info.kind === 'start' ? startBody(info.url.searchParams, supplied) : null;
            headers.delete('content-type');
            request = new Request(info.kind === 'address' ? info.url : API + START, {
                method: info.kind === 'address' ? 'GET' : 'POST', headers, body,
                credentials: request.credentials, mode: request.mode, cache: request.cache,
                redirect: request.redirect, referrer: request.referrer,
                referrerPolicy: request.referrerPolicy, signal: request.signal,
                integrity: request.integrity, keepalive: request.keepalive
            });
        }
        const response = await nativeFetch.call(this, request);
        if (info.kind === 'start' || !response.ok) return response;
        try {
            const original = await response.clone().json();
            const mapped = transform(original, info.kind);
            return mapped === original ? response : mappedResponse(response, JSON.stringify(mapped));
        } catch { return response; }
    };
    console.info('[还我推流权] 1.1.0 已加载（新版推流地址 / 开播接口兼容）');
})();
