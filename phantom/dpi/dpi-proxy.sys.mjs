/**
 * Phantom DPI Proxy v2
 * Локальный TCP-прокси с фрагментацией TLS ClientHello
 *
 * v2 изменения:
 *   - TLS Record Split: разбиение ClientHello на 2 валидных TLS-record
 *   - Combo: TLS record split + TCP fragmentation
 *   - Retry с автоматическим переключением стратегий при отказе
 *   - Chaining: маршрутизация через внешний прокси после фрагментации
 *   - Улучшенные таймауты и обработка ошибок
 *   - Статистика по стратегиям
 */

import { STRATEGY } from "resource://phantom/dpi/dpi-engine.sys.mjs";

const PROXY_BACKLOG = 256;
const READ_TIMEOUT = 30000;
const CONNECT_TIMEOUT = 15000;
const RELAY_BUFFER = 131072;     // 128KB
const MAX_RETRY = 2;             // retry with next strategy

// ── Helpers: XPCOM stream I/O ───────────────────────────────────────────────

function readAsync(asyncStream, timeout) {
    return new Promise((resolve, reject) => {
        const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        const cleanup = () => { try { timer.cancel(); } catch {} };

        timer.initWithCallback(() => {
            cleanup();
            reject(new Error("Read timeout"));
        }, timeout || READ_TIMEOUT, Ci.nsITimer.TYPE_ONE_SHOT);

        asyncStream.asyncWait({
            onInputStreamReady(stream) {
                cleanup();
                try {
                    const available = stream.available();
                    if (available === 0) { resolve(null); return; }

                    const bis = Cc["@mozilla.org/binaryinputstream;1"]
                        .createInstance(Ci.nsIBinaryInputStream);
                    bis.setInputStream(stream);
                    const count = Math.min(available, RELAY_BUFFER);
                    const buf = new Uint8Array(bis.readByteArray(count));
                    resolve(buf);
                } catch (e) {
                    if (e.result === Cr.NS_BASE_STREAM_CLOSED || e.result === Cr.NS_ERROR_NET_RESET) {
                        resolve(null);
                    } else {
                        reject(e);
                    }
                }
            }
        }, 0, 0, Services.tm.mainThread);
    });
}

function writeAll(outputStream, data) {
    const bos = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    bos.setOutputStream(outputStream);
    bos.writeByteArray(data);
    bos.flush();
}

function writeAllAsync(asyncOutputStream, data) {
    return new Promise((resolve, reject) => {
        asyncOutputStream.asyncWait({
            onOutputStreamReady(stream) {
                try { writeAll(stream, data); resolve(); }
                catch (e) { reject(e); }
            }
        }, 0, 0, Services.tm.mainThread);
    });
}

function delay(ms) {
    return new Promise(r => {
        const t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        t.initWithCallback(() => r(), ms, Ci.nsITimer.TYPE_ONE_SHOT);
    });
}

function concat(a, b) {
    const c = new Uint8Array(a.length + b.length);
    c.set(a); c.set(b, a.length);
    return c;
}

// ── TLS ClientHello Parser ──────────────────────────────────────────────────

function findSNI(data) {
    if (data.length < 44 || data[0] !== 0x16 || data[5] !== 0x01) return null;

    const recordLength = (data[3] << 8) | data[4];
    if (data.length < 5 + recordLength) return null;

    let offset = 9 + 2 + 32; // record(5) + handshake(4) + version(2) + random(32)

    if (offset >= data.length) return null;
    const sessionIdLen = data[offset];
    offset += 1 + sessionIdLen;

    if (offset + 2 > data.length) return null;
    const cipherLen = (data[offset] << 8) | data[offset + 1];
    offset += 2 + cipherLen;

    if (offset >= data.length) return null;
    const compLen = data[offset];
    offset += 1 + compLen;

    if (offset + 2 > data.length) return null;
    const extLen = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    const extEnd = offset + extLen;

    while (offset + 4 <= extEnd && offset + 4 <= data.length) {
        const extType = (data[offset] << 8) | data[offset + 1];
        const extDataLen = (data[offset + 2] << 8) | data[offset + 3];

        if (extType === 0x0000 && extDataLen >= 5) {
            const sniStart = offset;
            const sniTotalLen = 4 + extDataLen;
            const nameOffset = offset + 4 + 2 + 1;
            const nameLen = (data[nameOffset] << 8) | data[nameOffset + 1];
            const nameStart = nameOffset + 2;

            if (nameStart + nameLen <= data.length) {
                let hostname = "";
                for (let i = nameStart; i < nameStart + nameLen; i++) hostname += String.fromCharCode(data[i]);
                return { sniOffset: sniStart, sniLength: sniTotalLen, nameOffset: nameStart, nameLength: nameLen, hostname };
            }
            return null;
        }
        offset += 4 + extDataLen;
    }
    return null;
}

function isClientHello(data) {
    return data.length >= 6 && data[0] === 0x16 && data[5] === 0x01;
}

// ── Fragmentation Strategies ────────────────────────────────────────────────

function fragmentData(data, strategy, sniInfo, fragmentDelay, microFragSize) {
    switch (strategy) {
        case STRATEGY.SPLIT_SNI:        return fragmentAtSNI(data, sniInfo, fragmentDelay);
        case STRATEGY.SPLIT_RECORD:     return fragmentAtRecord(data, fragmentDelay);
        case STRATEGY.MICRO_FRAG:       return microFragment(data, microFragSize, fragmentDelay);
        case STRATEGY.TLS_RECORD_SPLIT: return tlsRecordSplit(data, sniInfo, fragmentDelay);
        case STRATEGY.COMBO:            return comboFragment(data, sniInfo, fragmentDelay);
        default:                        return [{ data, delayAfter: 0 }];
    }
}

// ── SPLIT_SNI ───────────────────────────────────────────────────────────────

function fragmentAtSNI(data, sniInfo, delayMs) {
    if (!sniInfo) return fragmentAtRecord(data, delayMs);
    const splitPoint = sniInfo.nameOffset + Math.floor(sniInfo.nameLength / 2);
    if (splitPoint <= 0 || splitPoint >= data.length) return fragmentAtRecord(data, delayMs);
    return [
        { data: data.slice(0, splitPoint), delayAfter: delayMs },
        { data: data.slice(splitPoint), delayAfter: 0 },
    ];
}

// ── SPLIT_RECORD ────────────────────────────────────────────────────────────

function fragmentAtRecord(data, delayMs) {
    const splitPoint = Math.min(3, data.length - 1);
    if (splitPoint <= 0) return [{ data, delayAfter: 0 }];
    return [
        { data: data.slice(0, splitPoint), delayAfter: delayMs },
        { data: data.slice(splitPoint), delayAfter: 0 },
    ];
}

// ── MICRO_FRAG ──────────────────────────────────────────────────────────────

function microFragment(data, chunkSize, delayMs) {
    const fragments = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, data.length);
        fragments.push({ data: data.slice(i, end), delayAfter: end >= data.length ? 0 : delayMs });
    }
    return fragments;
}

// ── TLS_RECORD_SPLIT (v2) ──────────────────────────────────────────────────
//
// Разбиваем один TLS record с ClientHello на два валидных TLS record.
// Каждый record содержит часть handshake data.
// DPI видит два отдельных record, ни один из которых не содержит полный SNI.
//
// Формат TLS record: type(1) + version(2) + length(2) + data(length)
// Мы берём данные handshake и разрезаем их пополам (или на границе SNI).

function tlsRecordSplit(data, sniInfo, delayMs) {
    if (data.length < 10 || data[0] !== 0x16) return [{ data, delayAfter: 0 }];

    const recordType = data[0];           // 0x16 = Handshake
    const versionMajor = data[1];
    const versionMinor = data[2];
    const recordDataLen = (data[3] << 8) | data[4];
    const recordData = data.slice(5, 5 + recordDataLen);

    // Choose split point within the handshake data
    let splitIdx;
    if (sniInfo && sniInfo.nameOffset > 5) {
        // Split in the middle of the hostname within the handshake data
        splitIdx = (sniInfo.nameOffset - 5) + Math.floor(sniInfo.nameLength / 2);
    } else {
        // Default: split in the middle
        splitIdx = Math.floor(recordData.length / 2);
    }

    splitIdx = Math.max(1, Math.min(splitIdx, recordData.length - 1));

    const part1 = recordData.slice(0, splitIdx);
    const part2 = recordData.slice(splitIdx);

    // Build two valid TLS records
    const record1 = new Uint8Array(5 + part1.length);
    record1[0] = recordType;
    record1[1] = versionMajor;
    record1[2] = versionMinor;
    record1[3] = (part1.length >> 8) & 0xFF;
    record1[4] = part1.length & 0xFF;
    record1.set(part1, 5);

    const record2 = new Uint8Array(5 + part2.length);
    record2[0] = recordType;
    record2[1] = versionMajor;
    record2[2] = versionMinor;
    record2[3] = (part2.length >> 8) & 0xFF;
    record2[4] = part2.length & 0xFF;
    record2.set(part2, 5);

    return [
        { data: record1, delayAfter: delayMs },
        { data: record2, delayAfter: 0 },
    ];
}

// ── COMBO (v2) ──────────────────────────────────────────────────────────────
//
// Сначала TLS record split → затем TCP фрагментация первого record.
// Двойная защита: DPI видит неполный record, который к тому же разбит по TCP.

function comboFragment(data, sniInfo, delayMs) {
    // Step 1: TLS record split
    const tlsFragments = tlsRecordSplit(data, sniInfo, delayMs);
    if (tlsFragments.length < 2) return tlsFragments;

    // Step 2: TCP-fragment the first TLS record (split at byte 3)
    const firstRecord = tlsFragments[0].data;
    const tcpSplit = Math.min(3, firstRecord.length - 1);

    return [
        { data: firstRecord.slice(0, tcpSplit), delayAfter: delayMs },
        { data: firstRecord.slice(tcpSplit), delayAfter: delayMs },
        { data: tlsFragments[1].data, delayAfter: 0 },
    ];
}

// ── HTTP Host header modification ───────────────────────────────────────────

function modifyHttpRequest(data) {
    let str = "";
    for (let i = 0; i < data.length; i++) str += String.fromCharCode(data[i]);

    str = str.replace(/^(Host):/im, () => "hOsT:");
    str = str.replace(/^hOsT:\s*([^\s\r\n:]+)/im, (_, host) => {
        const dotHost = host.endsWith(".") ? host : host + ".";
        return `hOsT: ${dotHost}`;
    });
    str = str.replace(/^((?:GET|POST|HEAD|PUT|DELETE|PATCH|OPTIONS)\s+\S+)\s+(HTTP\/)/im, (_, method, http) => {
        return `${method}  ${http}`;
    });

    const buf = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
    return buf;
}

// ── Proxy Connection Handler ────────────────────────────────────────────────

class ProxyConnection {
    #clientInput = null;
    #clientOutput = null;
    #targetInput = null;
    #targetOutput = null;
    #clientTransport = null;
    #targetTransport = null;
    #engine = null;
    #externalProxy = null;       // { type, host, port } — chain through external proxy
    #host = "";
    #port = 0;
    #closed = false;
    #onClose = null;
    #usedStrategy = null;

    constructor(clientTransport, engine, externalProxy, onClose) {
        this.#clientTransport = clientTransport;
        this.#engine = engine;
        this.#externalProxy = externalProxy;
        this.#onClose = onClose;

        try {
            this.#clientInput = clientTransport.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
            this.#clientOutput = clientTransport.openOutputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncOutputStream);
        } catch (e) {
            console.warn("[DPI Proxy] Failed to open client streams:", e.message);
            this.close();
        }
    }

    async start() {
        if (this.#closed) return;
        try {
            const firstData = await readAsync(this.#clientInput, 10000);
            if (!firstData) { this.close(); return; }

            let requestLine = "";
            for (let i = 0; i < Math.min(firstData.length, 4096); i++) {
                if (firstData[i] === 0x0D || firstData[i] === 0x0A) break;
                requestLine += String.fromCharCode(firstData[i]);
            }

            if (requestLine.startsWith("CONNECT")) {
                await this.#handleConnect(requestLine, firstData);
            } else {
                await this.#handleHttp(requestLine, firstData);
            }
        } catch (e) {
            if (!this.#closed) console.debug("[DPI Proxy] Connection error:", e.message);
            this.close();
        }
    }

    // ── CONNECT (HTTPS) ─────────────────────────────────────

    async #handleConnect(requestLine, rawRequest) {
        const match = requestLine.match(/^CONNECT\s+([^\s:]+):(\d+)\s+HTTP/i);
        if (!match) { this.close(); return; }

        this.#host = match[1];
        this.#port = parseInt(match[2], 10);

        // Read remaining headers
        let headerBuf = rawRequest;
        let headerStr = "";
        for (let i = 0; i < headerBuf.length; i++) headerStr += String.fromCharCode(headerBuf[i]);

        while (!headerStr.includes("\r\n\r\n")) {
            const more = await readAsync(this.#clientInput, 5000);
            if (!more) { this.close(); return; }
            headerBuf = concat(headerBuf, more);
            for (let i = headerStr.length; i < headerBuf.length; i++) headerStr += String.fromCharCode(headerBuf[i]);
        }

        // Connect to target (directly or through external proxy)
        const connected = await this.#connectToTarget(this.#host, this.#port);
        if (!connected) {
            try { writeAll(this.#clientOutput, new TextEncoder().encode("HTTP/1.1 502 Bad Gateway\r\n\r\n")); } catch {}
            this.#engine.recordFailed();
            this.close();
            return;
        }

        writeAll(this.#clientOutput, new TextEncoder().encode("HTTP/1.1 200 Connection Established\r\n\r\n"));
        this.#engine.recordBypassed();

        // TLS relay with fragmentation + retry
        await this.#relayTLSWithRetry();
    }

    // ── HTTP ────────────────────────────────────────────────

    async #handleHttp(requestLine, rawRequest) {
        const match = requestLine.match(/^\w+\s+https?:\/\/([^\s/:]+)(?::(\d+))?/i);
        if (!match) { this.close(); return; }

        this.#host = match[1];
        this.#port = match[2] ? parseInt(match[2], 10) : 80;

        const connected = await this.#connectToTarget(this.#host, this.#port);
        if (!connected) { this.#engine.recordFailed(); this.close(); return; }

        this.#engine.recordBypassed();

        // Modify request for DPI bypass
        let modified = modifyHttpRequest(rawRequest);

        // Convert absolute URL to relative
        let reqStr = "";
        for (let i = 0; i < modified.length; i++) reqStr += String.fromCharCode(modified[i]);
        reqStr = reqStr.replace(/^(\w+)\s+https?:\/\/[^\s\/]+(\/\S*)/im, "$1 $2");
        const relBuf = new Uint8Array(reqStr.length);
        for (let i = 0; i < reqStr.length; i++) relBuf[i] = reqStr.charCodeAt(i);

        const fragments = fragmentAtRecord(relBuf, this.#engine.fragmentDelay);
        for (const frag of fragments) {
            await writeAllAsync(this.#targetOutput, frag.data);
            if (frag.delayAfter > 0) await delay(frag.delayAfter);
        }

        this.#relayBidirectional();
    }

    // ── TLS relay with retry (v2) ───────────────────────────

    async #relayTLSWithRetry() {
        const firstPacket = await readAsync(this.#clientInput, 10000);
        if (!firstPacket) { this.close(); return; }

        if (!isClientHello(firstPacket)) {
            await writeAllAsync(this.#targetOutput, firstPacket);
            this.#relayBidirectional();
            return;
        }

        const sniInfo = findSNI(firstPacket);
        const strategies = this.#engine.getFallbackStrategies(this.#host);

        // Try primary strategy
        const strategy = strategies[0];
        this.#usedStrategy = strategy;

        // Verbose per-connection logging removed for performance

        const fragments = fragmentData(firstPacket, strategy, sniInfo, this.#engine.fragmentDelay, this.#engine.microFragSize);

        try {
            for (const frag of fragments) {
                await writeAllAsync(this.#targetOutput, frag.data);
                if (frag.delayAfter > 0) await delay(frag.delayAfter);
            }

            // Report success after first data comes back from server
            this.#relayBidirectionalWithSuccessReport(sniInfo);
        } catch (e) {
            // Strategy failed — report and retry would happen on next connection
            this.#engine.reportStrategyFailure(this.#host, strategy);
            console.debug(`[DPI Proxy] Strategy ${strategy} failed for ${this.#host}: ${e.message}`);
            this.close();
        }
    }

    // ── Bidirectional relay ─────────────────────────────────

    #relayBidirectional() {
        this.#pumpStream(this.#clientInput, this.#targetOutput);
        this.#pumpStream(this.#targetInput, this.#clientOutput);
    }

    /**
     * Relay with success reporting: once first response byte arrives,
     * report the strategy as successful for this domain.
     */
    #relayBidirectionalWithSuccessReport(sniInfo) {
        this.#pumpStream(this.#clientInput, this.#targetOutput);

        // For target → client, intercept first read to report success
        let firstResponse = true;
        const pumpWithReport = () => {
            if (this.#closed) return;
            this.#targetInput.asyncWait({
                onInputStreamReady: (stream) => {
                    if (this.#closed) return;
                    try {
                        const available = stream.available();
                        if (available === 0) { this.close(); return; }

                        const sis = Cc["@mozilla.org/scriptableinputstream;1"]
                            .createInstance(Ci.nsIScriptableInputStream);
                        sis.init(stream);
                        const raw = sis.readBytes(Math.min(available, RELAY_BUFFER));

                        const bos = Cc["@mozilla.org/binaryoutputstream;1"]
                            .createInstance(Ci.nsIBinaryOutputStream);
                        bos.setOutputStream(this.#clientOutput);
                        bos.writeBytes(raw, raw.length);
                        bos.flush();

                        if (firstResponse && this.#usedStrategy) {
                            firstResponse = false;
                            this.#engine.reportStrategySuccess(this.#host, this.#usedStrategy);
                        }

                        pumpWithReport();
                    } catch { this.close(); }
                }
            }, 0, 0, Services.tm.mainThread);
        };
        pumpWithReport();
    }

    #pumpStream(input, output) {
        const pump = () => {
            if (this.#closed) return;
            input.asyncWait({
                onInputStreamReady: (stream) => {
                    if (this.#closed) return;
                    try {
                        const available = stream.available();
                        if (available === 0) { this.close(); return; }

                        const sis = Cc["@mozilla.org/scriptableinputstream;1"]
                            .createInstance(Ci.nsIScriptableInputStream);
                        sis.init(stream);
                        const raw = sis.readBytes(Math.min(available, RELAY_BUFFER));

                        const bos = Cc["@mozilla.org/binaryoutputstream;1"]
                            .createInstance(Ci.nsIBinaryOutputStream);
                        bos.setOutputStream(output);
                        bos.writeBytes(raw, raw.length);
                        bos.flush();

                        pump();
                    } catch { this.close(); }
                }
            }, 0, 0, Services.tm.mainThread);
        };
        pump();
    }

    // ── Target connection ───────────────────────────────────

    #connectToTarget(host, port) {
        return new Promise((resolve) => {
            try {
                const sts = Cc["@mozilla.org/network/socket-transport-service;1"]
                    .getService(Ci.nsISocketTransportService);

                // If external proxy is configured, connect through it
                let connectHost = host;
                let connectPort = port;
                let socketTypes = [];

                if (this.#externalProxy) {
                    connectHost = this.#externalProxy.host;
                    connectPort = this.#externalProxy.port;

                    if (this.#externalProxy.type === "socks5" || this.#externalProxy.type === "socks") {
                        socketTypes = ["socks"];
                    } else if (this.#externalProxy.type === "socks4") {
                        socketTypes = ["socks4"];
                    }
                    // For HTTP proxy chaining, we'd need to send another CONNECT
                    // through the proxy, which is handled by connecting to proxy
                    // and sending CONNECT manually
                }

                this.#targetTransport = sts.createTransport(socketTypes, connectHost, connectPort, null, null);
                this.#targetTransport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT,
                    Math.floor(CONNECT_TIMEOUT / 1000));
                this.#targetTransport.setTimeout(Ci.nsISocketTransport.TIMEOUT_READ_WRITE, 120);

                this.#targetInput = this.#targetTransport.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
                this.#targetOutput = this.#targetTransport.openOutputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncOutputStream);

                // If using HTTP external proxy, send CONNECT first
                if (this.#externalProxy &&
                    (this.#externalProxy.type === "http" || this.#externalProxy.type === "https") &&
                    host !== connectHost) {

                    this.#targetOutput.asyncWait({
                        onOutputStreamReady: async () => {
                            try {
                                const connectReq = new TextEncoder().encode(
                                    `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`
                                );
                                writeAll(this.#targetOutput, connectReq);

                                // Read proxy response
                                const resp = await readAsync(this.#targetInput, CONNECT_TIMEOUT);
                                if (!resp) { resolve(false); return; }

                                let respStr = "";
                                for (let i = 0; i < Math.min(resp.length, 128); i++) respStr += String.fromCharCode(resp[i]);

                                if (respStr.includes("200")) {
                                    resolve(true);
                                } else {
                                    console.warn(`[DPI Proxy] External proxy rejected CONNECT: ${respStr.split("\r\n")[0]}`);
                                    resolve(false);
                                }
                            } catch (e) {
                                resolve(false);
                            }
                        }
                    }, 0, 0, Services.tm.mainThread);
                    return;
                }

                this.#targetOutput.asyncWait({
                    onOutputStreamReady: () => resolve(true)
                }, 0, 0, Services.tm.mainThread);
            } catch (e) {
                console.warn(`[DPI Proxy] Connect failed ${host}:${port}:`, e.message);
                resolve(false);
            }
        });
    }

    // ── Cleanup ─────────────────────────────────────────────

    close() {
        if (this.#closed) return;
        this.#closed = true;

        const cs = (s) => { try { s.close(); } catch {} };
        const ct = (t) => { try { t.close(Cr.NS_OK); } catch {} };

        if (this.#clientInput) cs(this.#clientInput);
        if (this.#clientOutput) cs(this.#clientOutput);
        if (this.#targetInput) cs(this.#targetInput);
        if (this.#targetOutput) cs(this.#targetOutput);
        if (this.#clientTransport) ct(this.#clientTransport);
        if (this.#targetTransport) ct(this.#targetTransport);

        if (this.#onClose) this.#onClose(this);
    }
}

// ── DPI Proxy Server ────────────────────────────────────────────────────────

export class DPIProxy {
    #server = null;
    #port = 0;
    #engine = null;
    #externalProxy = null;
    #connections = new Set();
    #running = false;
    #totalConnections = 0;

    get port() { return this.#port; }
    get running() { return this.#running; }
    get connectionCount() { return this.#connections.size; }
    get totalConnections() { return this.#totalConnections; }

    /**
     * Запускает прокси
     * @param {DPIEngine} engine
     * @param {Object} [externalProxy] — { type, host, port } для chaining
     */
    init(engine, externalProxy) {
        this.#engine = engine;
        this.#externalProxy = externalProxy || null;

        try {
            this.#server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
            this.#server.init(0, true, PROXY_BACKLOG);
            this.#port = this.#server.port;
            this.#server.asyncListen(this);
            this.#running = true;

            const chainStr = this.#externalProxy
                ? ` → ${this.#externalProxy.type}://${this.#externalProxy.host}:${this.#externalProxy.port}`
                : "";
            console.log(`[DPI Proxy] Listening on 127.0.0.1:${this.#port}${chainStr}`);
        } catch (e) {
            console.error("[DPI Proxy] Failed to start:", e.message);
            this.#running = false;
        }
    }

    /**
     * Обновить внешний прокси для chaining
     */
    setExternalProxy(proxyInfo) {
        this.#externalProxy = proxyInfo;
        console.log(`[DPI Proxy] External proxy: ${proxyInfo ? `${proxyInfo.type}://${proxyInfo.host}:${proxyInfo.port}` : 'none'}`);
    }

    // ── nsIServerSocketListener ─────────────────────────────

    onSocketAccepted(serverSocket, clientTransport) {
        this.#totalConnections++;
        const conn = new ProxyConnection(clientTransport, this.#engine, this.#externalProxy, (c) => {
            this.#connections.delete(c);
        });
        this.#connections.add(conn);
        conn.start().catch(e => {
            console.debug("[DPI Proxy] Handler error:", e.message);
            conn.close();
        });
    }

    onStopListening(serverSocket, status) {
        this.#running = false;
        if (status !== Cr.NS_BINDING_ABORTED) {
            console.warn(`[DPI Proxy] Server stopped: 0x${status.toString(16)}`);
        }
    }

    // ── Shutdown ────────────────────────────────────────────

    shutdown() {
        if (this.#server) { try { this.#server.close(); } catch {} this.#server = null; }
        for (const conn of this.#connections) conn.close();
        this.#connections.clear();
        this.#running = false;
        console.log("[DPI Proxy] Shutdown complete");
    }
}

export const phantomDPIProxy = new DPIProxy();
