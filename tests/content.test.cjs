const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
const api = 'https://api.live.bilibili.com';
const permission = api + '/xlive/app-blink/v1/live/GetWebLivePermission';
const address = api + '/xlive/app-blink/v1/live/FetchWebUpStreamAddr';
const webStart = api + '/xlive/app-blink/v1/streaming/WebLiveCenterStartLive';
const start = api + '/room/v1/Room/startLive';
const chooseArea = api + '/room/v1/Area/getMyChooseArea?roomid=123';

function fixture() {
    const calls = [];
    let payload = { code: 0, data: {} };
    class XHR extends EventTarget {
        constructor() { super(); this.responseType = ''; this.raw = ''; this.headers = {}; }
        open(method, url) {
            this.method = method; this.url = String(url); this.raw = ''; this.readyState = 1;
        }
        setRequestHeader(name, value) { this.headers[name] = value; }
        send(body) {
            calls.push({ method: this.method, url: this.url, body, xhr: this });
            this.raw = JSON.stringify(payload);
            this.json = JSON.parse(this.raw);
            this.status = 200; this.readyState = 4;
            this.dispatchEvent(new Event('readystatechange'));
            this.dispatchEvent(new Event('load'));
            this.dispatchEvent(new Event('loadend'));
        }
        get responseText() {
            if (this.responseType === 'json') throw new Error('InvalidStateError');
            return this.raw;
        }
        get response() { return this.responseType === 'json' ? this.json || null : this.raw; }
    }
    const window = { XMLHttpRequest: XHR, fetch: async (...args) => {
        calls.push({ args });
        return Response.json(payload);
    }};
    const context = vm.createContext({
        window, location: new URL('https://link.bilibili.com/#/my-room/start-live'),
        URL, URLSearchParams, Request, Response, Headers, FormData, TextEncoder,
        console: { info() {} }
    });
    vm.runInContext(code, context);
    return { window, calls, context, setPayload(value) { payload = value; },
        xhr(method, url, body) {
            const xhr = new XHR(); xhr.open(method, url); xhr.send(body); return xhr;
        }};
}

function verifySignature(body) {
    const params = new URLSearchParams(body);
    const sign = params.get('sign');
    params.delete('sign');
    const digest = createHash('md5').update(params.toString() + 'af125a0d5279fd576c1b4418a3e8276d').digest('hex');
    assert.equal(sign, digest);
    assert.equal(params.get('platform'), 'pc_link');
    assert.equal(params.get('appkey'), 'aae92bc66f3edfab');
    assert.equal(params.get('build'), '9343');
    assert.equal(params.get('csrf'), 'test-csrf');
    assert.equal(params.get('csrf_token'), 'test-csrf');
    assert.ok(Number(params.get('ts')) > 0);
    return params;
}

test('XHR redirects address lookup and maps the real response before all native events', () => {
    const f = fixture();
    f.xhr('GET', chooseArea);
    f.setPayload({ code: 0, data: { rtmp: { addr: 'rtmp://test', code: 'fake-key' }, stream_line: [1], extra: 7 } });
    const xhr = new f.window.XMLHttpRequest();
    const events = [];
    const listeners = [];
    for (const type of ['readystatechange', 'load', 'loadend']) {
        const listener = () => {
            events.push(type);
            assert.equal(JSON.parse(xhr.responseText).data.addr.addr, 'rtmp://test');
            assert.equal(xhr.response, xhr.responseText);
        };
        listeners.push([type, listener]);
        xhr.addEventListener(type, listener);
    }
    xhr.open('post', address);
    xhr.withCredentials = true;
    xhr.send('platform=pc&csrf=do-not-forward');
    const call = f.calls.at(-1);
    assert.equal(call.method, 'GET');
    assert.equal(call.url, api + '/live_stream/v1/StreamList/get_stream_by_roomId?room_id=123');
    assert.equal(call.body, null);
    assert.equal(xhr.withCredentials, true);
    assert.deepEqual(events, ['readystatechange', 'load', 'loadend']);
    assert.equal(JSON.parse(xhr.responseText).data.extra, 7);
    assert.equal(JSON.parse(xhr.responseText).data.rtmp, undefined);
    for (const [type, listener] of listeners) xhr.removeEventListener(type, listener);
    // Reusing the XHR for an unrelated URL must remove the transformation.
    xhr.open('GET', api + '/unrelated');
    xhr.send();
    assert.ok(JSON.parse(xhr.responseText).data.rtmp);
});

test('XHR permission works with responseType=json; server errors stay errors', () => {
    const f = fixture();
    const xhr = new f.window.XMLHttpRequest();
    xhr.responseType = 'json';
    f.setPayload({ code: 0, data: { allow_live: false, fans_threshold: 5000 } });
    xhr.open('GET', permission); xhr.send();
    assert.equal(xhr.response.data.allow_live, true);
    assert.equal(xhr.response.data.fans_threshold, 0);
    assert.equal(xhr.json.data.allow_live, false);
    assert.throws(() => xhr.responseText, /InvalidState/);
    f.setPayload({ code: 690001, message: 'server refusal', data: null });
    xhr.open('GET', permission); xhr.send();
    assert.equal(xhr.response.code, 690001);
    assert.equal(xhr.response.data, null);
});

test('fetch supports URL and Request inputs, keeps credentials, maps address schema', async () => {
    const f = fixture();
    await f.window.fetch(new URL(chooseArea));
    f.setPayload({ code: 0, data: { rtmp: { addr: 'rtmp://test' }, stream_line: [2] } });
    const request = new Request(address, { method: 'POST', credentials: 'include', body: 'platform=pc' });
    const response = await f.window.fetch(request);
    const actual = f.calls.at(-1).args[0];
    assert.equal(actual.method, 'GET');
    assert.equal(actual.credentials, 'include');
    assert.equal(actual.body, null);
    assert.equal((await response.clone().json()).data.addr.addr, 'rtmp://test');
    assert.deepEqual((await response.json()).data.line, [2]);
    assert.equal(response.bodyUsed, true);
    assert.throws(() => response.clone());
});

test('new start endpoint becomes a correctly signed legacy request via fetch and XHR', async () => {
    const f = fixture();
    const url = webStart + '?room_id=123&area_v2=87&csrf=test-csrf';
    const response = await f.window.fetch(url, { method: 'post', credentials: 'include' });
    assert.equal(response.status, 200);
    const actual = f.calls.at(-1).args[0];
    assert.equal(actual.url, start);
    assert.equal(actual.credentials, 'include');
    const params = verifySignature(await actual.text());
    assert.equal(params.get('room_id'), '123');
    assert.equal(params.get('area_v2'), '87');
    assert.ok(actual.headers.get('content-type').startsWith('application/x-www-form-urlencoded'));
    f.xhr('POST', webStart, 'room_id=123&area_v2=87&csrf_token=test-csrf');
    assert.equal(f.calls.at(-1).url, start);
    verifySignature(f.calls.at(-1).body);
});

test('fetch supports FormData starts and preserves genuine backend failures', async () => {
    const f = fixture();
    const data = new FormData();
    data.set('room_id', '123'); data.set('area_v2', '87'); data.set('csrf', 'test-csrf');
    f.setPayload({ code: 690001, message: 'server refusal', data: null });
    const response = await f.window.fetch(new Request(webStart, { method: 'POST', body: data }));
    verifySignature(await f.calls.at(-1).args[0].text());
    assert.equal((await response.json()).code, 690001);
    assert.equal((await (await f.window.fetch(permission)).json()).code, 690001);
});

test('unrelated hosts and unknown room IDs are passed through; installation is idempotent', async () => {
    const f = fixture();
    const fetch = f.window.fetch;
    vm.runInContext(code, f.context);
    assert.equal(f.window.fetch, fetch);
    const init = { method: 'POST', body: 'platform=pc' };
    await f.window.fetch('https://example.com' + new URL(webStart).pathname, init);
    assert.equal(f.calls.at(-1).args[1], init);
    f.xhr('POST', address, 'platform=pc');
    assert.equal(f.calls.at(-1).url, address);
    f.setPayload({ code: 0, data: { allow_live: false } });
    assert.equal((await (await f.window.fetch(permission)).json()).data.allow_live, true);
});
