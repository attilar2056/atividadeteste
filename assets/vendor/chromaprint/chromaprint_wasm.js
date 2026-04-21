/* tslint:disable */
import * as wasm from './chromaprint_wasm_bg';

let cachegetUint16Memory = null;
function getUint16Memory() {
    if (cachegetUint16Memory === null || cachegetUint16Memory.buffer !== wasm.memory.buffer) {
        cachegetUint16Memory = new Uint16Array(wasm.memory.buffer);
    }
    return cachegetUint16Memory;
}

let WASM_VECTOR_LEN = 0;

function passArray16ToWasm(arg) {
    const ptr = wasm.__wbindgen_malloc(arg.length * 2);
    getUint16Memory().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8');

let cachegetUint8Memory = null;
function getUint8Memory() {
    if (cachegetUint8Memory === null || cachegetUint8Memory.buffer !== wasm.memory.buffer) {
        cachegetUint8Memory = new Uint8Array(wasm.memory.buffer);
    }
    return cachegetUint8Memory;
}

function getStringFromWasm(ptr, len) {
    return cachedTextDecoder.decode(getUint8Memory().subarray(ptr, ptr + len));
}

let cachedGlobalArgumentPtr = null;
function globalArgumentPtr() {
    if (cachedGlobalArgumentPtr === null) {
        cachedGlobalArgumentPtr = wasm.__wbindgen_global_argument_ptr();
    }
    return cachedGlobalArgumentPtr;
}

let cachegetUint32Memory = null;
function getUint32Memory() {
    if (cachegetUint32Memory === null || cachegetUint32Memory.buffer !== wasm.memory.buffer) {
        cachegetUint32Memory = new Uint32Array(wasm.memory.buffer);
    }
    return cachegetUint32Memory;
}

function freeChromaprintContext(ptr) {

    wasm.__wbg_chromaprintcontext_free(ptr);
}
/**
*/
export class ChromaprintContext {

    free() {
        const ptr = this.ptr;
        this.ptr = 0;
        freeChromaprintContext(ptr);
    }

    /**
    * @returns {}
    */
    constructor() {
        this.ptr = wasm.chromaprintcontext_new();
    }
    /**
    * @param {Int16Array} arg0
    * @returns {void}
    */
    feed(arg0) {
        const ptr0 = passArray16ToWasm(arg0);
        const len0 = WASM_VECTOR_LEN;
        try {
            return wasm.chromaprintcontext_feed(this.ptr, ptr0, len0);

        } finally {
            wasm.__wbindgen_free(ptr0, len0 * 2);

        }

    }
    /**
    * @returns {string}
    */
    finish() {
        const ptr = this.ptr;
        this.ptr = 0;
        const retptr = globalArgumentPtr();
        wasm.chromaprintcontext_finish(retptr, ptr);
        const mem = getUint32Memory();
        const rustptr = mem[retptr / 4];
        const rustlen = mem[retptr / 4 + 1];

        const realRet = getStringFromWasm(rustptr, rustlen).slice();
        wasm.__wbindgen_free(rustptr, rustlen * 1);
        return realRet;

    }
}

export function __wbindgen_throw(ptr, len) {
    throw new Error(getStringFromWasm(ptr, len));
}

