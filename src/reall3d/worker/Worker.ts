// ================================
// Copyright (c) 2025 reall3d.com
// ================================
import { packHalf2x16 } from '../utils/CommonUtils';
import {
    WkActivePoints,
    WkBinVersion,
    WkCurrentMaxRadius,
    WkUploadTextureVersion,
    WkIndex,
    WkIsBigSceneMode,
    WkMaxRadius,
    WkMaxRenderCount,
    WkModelSplatCount,
    WkRenderSplatCount,
    WkSortTime,
    WkSplatDataBuffer,
    WkSplatIndex,
    WkTexdata,
    WkTextureReady,
    WkTopY,
    WkVersion,
    WkViewProjection,
    WkVisibleSplatCount,
    WkSortStartTime,
} from '../utils/consts/WkConstants';

interface Texture {
    /** 索引（0 | 1） */
    index: number;
    /** 纹理版本（毫秒时间戳） */
    version?: number;
    /** 坐标数据 */
    xyz?: Float32Array;
    /** 水印坐标数据 */
    wxyz?: number[];
    /** 纹理数据就绪标志 */
    textureReady?: boolean;
    /** 纹理数据就绪时间点 */
    textureReadyTime?: number;
    /** 是否活动状态 */
    active?: boolean;

    /** 包围盒极限点 */
    minX?: number;
    /** 包围盒极限点 */
    maxX?: number;
    /** 包围盒极限点 */
    minY?: number;
    /** 包围盒极限点 */
    maxY?: number;
    /** 包围盒极限点 */
    minZ?: number;
    /** 包围盒极限点 */
    maxZ?: number;

    // 例：共 m 个模型处理中，其中 v 个模型下载有数据且当前可见，有 r 个合并后的Splat待渲染
    /** 待渲染的Splat数量 */
    renderSplatCount?: number;
    /** 可见且可用的Splat数量 */
    visibleSplatCount?: number;
    /** 所有处理中的模型Splat数量合计 */
    modelSplatCount?: number;
}

let texture0: Texture = { index: 0 };
let texture1: Texture = { index: 1 };

let sortRunning: boolean;
const Epsilon: number = navigator.userAgent.includes('Mobi') ? 0.01 : 0.002;
let viewProj: number[];
let lastViewProj: number[] = [];
let distances: Int32Array; // new Int32Array(0);

let lastDataVersion: number = 0;
let lastSortVersion: number = 0;
let isBigSceneMode: boolean, binVer: number, topY: number, maxRadius: number;

function setCommonParams(isBigScene, verBin, topy, radius) {
    isBigSceneMode = isBigScene;
    binVer = verBin;
    topY = topy;
    maxRadius = radius;
}

function uploadTexture(buffer: Uint8Array, version: number, renderSplatCount: number, visibleSplatCount: number, modelSplatCount: number) {
    let texture: Texture;
    if (isBigSceneMode) {
        if (!texture0.xyz) {
            texture = texture0;
        } else if (!texture1.xyz) {
            texture = texture1;
        } else {
            texture = texture0.active ? texture1 : texture0;
        }
    } else {
        texture = texture0;
    }

    if (texture.xyz && !texture.textureReady) return false; // 没准备好
    if (!renderSplatCount && !texture.xyz) return false; // 初期无可渲染

    lastDataVersion = version;

    texture.textureReady = false;
    texture.version = version;
    texture.xyz = new Float32Array(renderSplatCount * 3);
    texture.wxyz = [];
    texture.renderSplatCount = renderSplatCount;
    texture.visibleSplatCount = visibleSplatCount;
    texture.modelSplatCount = modelSplatCount;
    const wIndex: number[] = [];

    const f32_buffer = new Float32Array(buffer);
    const ui32_buffer = new Uint32Array(buffer);
    const ui8_buffer = new Uint8Array(buffer);

    const texwidth = 1024 * 2;
    const texheight = Math.ceil((2 * renderSplatCount) / texwidth);
    const texdata = new Uint32Array(texwidth * texheight * 4);
    const texdata_c = new Uint8Array(texdata.buffer);
    const texdata_f = new Float32Array(texdata.buffer);
    // texdata_c.set(ui8_buffer, 0);

    let minX: number = renderSplatCount ? Infinity : 0;
    let maxX: number = renderSplatCount ? -Infinity : 0;
    let minY: number = renderSplatCount ? Infinity : 0;
    let maxY: number = renderSplatCount ? -Infinity : 0;
    let minZ: number = renderSplatCount ? Infinity : 0;
    let maxZ: number = renderSplatCount ? -Infinity : 0;

    let x: number, y: number, z: number;
    let scale: number[];
    let rot: number[];
    let tIdx: number = 0;
    for (let i = 0; i < renderSplatCount; i++) {
        if (ui32_buffer[8 * i + 3] & 65536) {
            wIndex.push(i);
            continue;
        }

        // x, y, z, watermark
        x = f32_buffer[8 * i + 0];
        y = f32_buffer[8 * i + 1];
        z = f32_buffer[8 * i + 2];

        texture.xyz[3 * tIdx + 0] = x;
        texture.xyz[3 * tIdx + 1] = y;
        texture.xyz[3 * tIdx + 2] = z;

        // min max
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);

        // texdata
        texdata_f[8 * tIdx + 0] = x;
        texdata_f[8 * tIdx + 1] = y;
        texdata_f[8 * tIdx + 2] = z;
        texdata[8 * tIdx + 3] = ui32_buffer[8 * i + 3];
        texdata[8 * tIdx + 4] = ui32_buffer[8 * i + 4];
        texdata[8 * tIdx + 5] = ui32_buffer[8 * i + 5];
        texdata[8 * tIdx + 6] = ui32_buffer[8 * i + 6];
        texdata[8 * tIdx + 7] = ui32_buffer[8 * i + 7];

        // // quaternions
        // scale = [f32_buffer[9 * i + 3], f32_buffer[9 * i + 4], f32_buffer[9 * i + 5]];
        // rot = [
        //     (ui8_buffer[36 * i + 28 + 0] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 1] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 2] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 3] - 128) / 128,
        // ];

        // // Compute the matrix product of S and R (M = S * R)
        // const M = [
        //     1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
        //     2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
        //     2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

        //     2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
        //     1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
        //     2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

        //     2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
        //     2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
        //     1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
        // ].map((k, i) => k * scale[Math.floor(i / 3)]);

        // const sigma = [
        //     M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
        //     M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
        //     M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
        //     M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
        //     M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
        //     M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
        // ];

        // texdata[8 * tIdx + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
        // texdata[8 * tIdx + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
        // texdata[8 * tIdx + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);

        // // r, g, b, a
        // texdata_c[4 * (8 * tIdx + 7) + 0] = ui8_buffer[36 * i + 24 + 0];
        // texdata_c[4 * (8 * tIdx + 7) + 1] = ui8_buffer[36 * i + 24 + 1];
        // texdata_c[4 * (8 * tIdx + 7) + 2] = ui8_buffer[36 * i + 24 + 2];
        // texdata_c[4 * (8 * tIdx + 7) + 3] = ui8_buffer[36 * i + 24 + 3];

        tIdx++;
    }

    wIndex.length && (texture.wxyz = []);
    for (let i of wIndex) {
        // x, y, z, watermark
        x = f32_buffer[8 * i + 0];
        y = f32_buffer[8 * i + 1];
        z = f32_buffer[8 * i + 2];

        texture.wxyz.push(x, y, z);

        // min max
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);

        // texdata
        texdata_f[8 * tIdx + 0] = x;
        texdata_f[8 * tIdx + 1] = y;
        texdata_f[8 * tIdx + 2] = z;
        texdata[8 * tIdx + 3] = ui32_buffer[8 * i + 3];
        texdata[8 * tIdx + 4] = ui32_buffer[8 * i + 4];
        texdata[8 * tIdx + 5] = ui32_buffer[8 * i + 5];
        texdata[8 * tIdx + 6] = ui32_buffer[8 * i + 6];
        texdata[8 * tIdx + 7] = ui32_buffer[8 * i + 7];

        // // x, y, z
        // texdata_f[8 * tIdx + 0] = x;
        // texdata_f[8 * tIdx + 1] = y;
        // texdata_f[8 * tIdx + 2] = z;

        // // 水印
        // texdata[8 * tIdx + 3] = 65536;

        // // quaternions
        // scale = [f32_buffer[9 * i + 3], f32_buffer[9 * i + 4], f32_buffer[9 * i + 5]];
        // rot = [
        //     (ui8_buffer[36 * i + 28 + 0] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 1] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 2] - 128) / 128,
        //     (ui8_buffer[36 * i + 28 + 3] - 128) / 128,
        // ];

        // // Compute the matrix product of S and R (M = S * R)
        // const M = [
        //     1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
        //     2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
        //     2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

        //     2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
        //     1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
        //     2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

        //     2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
        //     2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
        //     1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
        // ].map((k, i) => k * scale[Math.floor(i / 3)]);

        // const sigma = [
        //     M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
        //     M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
        //     M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
        //     M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
        //     M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
        //     M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
        // ];

        // texdata[8 * tIdx + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
        // texdata[8 * tIdx + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
        // texdata[8 * tIdx + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);

        // // r, g, b, a
        // texdata_c[4 * (8 * tIdx + 7) + 0] = ui8_buffer[36 * i + 24 + 0];
        // texdata_c[4 * (8 * tIdx + 7) + 1] = ui8_buffer[36 * i + 24 + 1];
        // texdata_c[4 * (8 * tIdx + 7) + 2] = ui8_buffer[36 * i + 24 + 2];
        // texdata_c[4 * (8 * tIdx + 7) + 3] = ui8_buffer[36 * i + 24 + 3];

        tIdx++;
    }

    const currentMaxRadius = Math.sqrt(maxX * maxX + topY * topY + maxZ * maxZ); // 当前模型数据范围离高点的最大半径
    texture.minX = minX;
    texture.maxX = maxX;
    texture.minY = minY;
    texture.maxY = maxY;
    texture.minZ = minZ;
    texture.maxZ = maxZ;
    const { index } = texture;

    (self as any).postMessage(
        {
            [WkTexdata]: texdata,
            [WkIndex]: index,
            [WkVersion]: version,
            [WkRenderSplatCount]: renderSplatCount,
            [WkVisibleSplatCount]: visibleSplatCount,
            [WkModelSplatCount]: modelSplatCount,
            [WkTopY]: topY,
            [WkMaxRadius]: maxRadius,
            [WkCurrentMaxRadius]: currentMaxRadius,
        },
        [texdata.buffer],
    );

    return true;
}

function runSort(sortViewProj: number[]) {
    let texture: Texture = texture0;
    if (isBigSceneMode) {
        if (!texture0.textureReady && !texture1.textureReady) {
            return;
        } else if (texture0.textureReady && !texture1.textureReady) {
            texture = texture0;
            texture0.active = true;
            texture1.active = false;
        } else if (!texture0.textureReady && texture1.textureReady) {
            texture = texture1;
            texture0.active = false;
            texture1.active = true;
        } else if (texture0.textureReadyTime > texture1.textureReadyTime) {
            texture = texture0;
            texture0.active = true;
            texture1.active = false;
        } else {
            texture = texture1;
            texture0.active = false;
            texture1.active = true;
        }
    } else {
        texture.active = true;
    }

    const { xyz, wxyz, renderSplatCount, visibleSplatCount, modelSplatCount, index, version } = texture;

    if (lastSortVersion === version) {
        let diff =
            Math.abs(lastViewProj[2] - sortViewProj[2]) +
            Math.abs(lastViewProj[6] - sortViewProj[6]) +
            Math.abs(lastViewProj[10] - sortViewProj[10]) +
            Math.abs(lastViewProj[14] - sortViewProj[14]);
        if (diff < Epsilon) {
            return;
        }
    }
    lastViewProj = sortViewProj;
    lastSortVersion = version;

    let startTime = Date.now();
    let depthIndex: Uint32Array;
    if (!renderSplatCount) {
        // 没有渲染数据时直接处理
        depthIndex = new Uint32Array(0);
        (self as any).postMessage(
            {
                [WkSplatIndex]: depthIndex,
                [WkRenderSplatCount]: renderSplatCount,
                [WkVisibleSplatCount]: visibleSplatCount,
                [WkModelSplatCount]: modelSplatCount,
                [WkIndex]: index,
                [WkVersion]: version,
                [WkSortTime]: 0,
                [WkSortStartTime]: startTime,
            },
            [depthIndex.buffer],
        );
        setTimeout(() => postActivePoints());
        return;
    }

    // 排序
    const waterCnt = wxyz.length / 3;
    const dataCount = renderSplatCount - waterCnt;
    depthIndex = new Uint32Array(renderSplatCount);
    const { maxDepth, minDepth } = getDepth(texture, viewProj);
    if (maxDepth - minDepth <= 0.0001) {
        for (let i = 0; i < renderSplatCount; i++) depthIndex[i] = i;
    } else {
        // 数据
        // let COUNT: number = Math.min(Math.max((dataCount / 10) | 0, 512), 65535);
        let COUNT: number = Math.min(dataCount, 65535);
        let depthInv: number = (COUNT - 1) / (maxDepth - minDepth);
        let counters: Int32Array = new Int32Array(COUNT);
        for (let i = 0, idx = 0; i < dataCount; i++) {
            idx = ((computeDepth(sortViewProj, xyz[3 * i + 0], xyz[3 * i + 1], xyz[3 * i + 2]) - minDepth) * depthInv) | 0;
            counters[(distances[i] = idx)]++;
        }
        for (let i = 1; i < COUNT; i++) counters[i] += counters[i - 1];
        for (let i = 0; i < dataCount; i++) depthIndex[--counters[distances[i]]] = i;

        // 水印
        if (waterCnt) {
            // COUNT = Math.min(Math.max((dataCount / 10) | 0, 512), 65535);
            COUNT = Math.min(dataCount, 65535);
            depthInv = (COUNT - 1) / (maxDepth - minDepth);
            counters = new Int32Array(COUNT);
            for (let i = 0, idx = 0; i < waterCnt; i++) {
                idx = ((computeDepth(sortViewProj, wxyz[3 * i + 0], wxyz[3 * i + 1], wxyz[3 * i + 2]) - minDepth) * depthInv) | 0;
                counters[(distances[i] = idx)]++;
            }
            for (let i = 1; i < COUNT; i++) counters[i] += counters[i - 1];
            for (let i = 0; i < waterCnt; i++) depthIndex[dataCount + --counters[distances[i]]] = dataCount + i;
        }
    }

    (self as any).postMessage(
        {
            [WkSplatIndex]: depthIndex,
            [WkRenderSplatCount]: renderSplatCount,
            [WkVisibleSplatCount]: visibleSplatCount,
            [WkModelSplatCount]: modelSplatCount,
            [WkIndex]: index,
            [WkVersion]: version,
            [WkSortStartTime]: startTime,
            [WkSortTime]: Date.now() - startTime,
        },
        [depthIndex.buffer],
    );
    setTimeout(() => postActivePoints(texture));
}

function computeDepth(svp: number[], x: number, y: number, z: number): number {
    // return (svp[2] * x + svp[6] * y + svp[10] * z) * -4096;
    return -(svp[2] * x + svp[6] * y + svp[10] * z);
    // return -(svp[2] * x + svp[6] * y + svp[10] * z + svp[14]);

    // return -(svp[3] * x + -svp[7] * y + -svp[11] * z); // map
    // return -(svp[3] * x + -svp[7] * y + -svp[11] * z + svp[15]); // map
}

function getDepth(texture: Texture, sortViewProj: number[]): any {
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    let dep = 0;
    let xMin = texture.minX;
    let xMax = texture.maxX;
    let yMin = texture.minY;
    let yMax = texture.maxY;
    let zMin = texture.minZ;
    let zMax = texture.maxZ;

    dep = computeDepth(sortViewProj, xMin, yMin, zMin);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMin, yMin, zMax);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMin, yMax, zMin);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMin, yMax, zMax);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMax, yMin, zMin);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMax, yMin, zMax);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMax, yMax, zMin);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    dep = computeDepth(sortViewProj, xMax, yMax, zMax);
    maxDepth = Math.max(maxDepth, dep);
    minDepth = Math.min(minDepth, dep);
    return { maxDepth, minDepth };
}

const throttledSort = () => {
    if (!sortRunning) {
        sortRunning = true;
        const sortViewProj = viewProj;
        runSort(sortViewProj);
        setTimeout(() => !(sortRunning = false) && sortViewProj !== viewProj && throttledSort());
    }
};

let xyzVersion: number = 0;
function postActivePoints(texture?: Texture) {
    let f32XYZ: Float32Array;
    if (!texture) {
        xyzVersion = 0;
        f32XYZ = new Float32Array(0);
    } else if (texture.version === xyzVersion) {
        return;
    } else {
        xyzVersion = texture.version;
        let splatCount: number = texture?.active ? texture.renderSplatCount : 0;
        f32XYZ = new Float32Array(splatCount * 3);
        if (splatCount > 0) {
            let xyz: number[] = texture.xyz ? [...texture.xyz] : [];
            for (let i = 0; i < splatCount; i++) {
                f32XYZ[i * 3 + 0] = xyz[i * 3 + 0];
                f32XYZ[i * 3 + 1] = xyz[i * 3 + 1];
                f32XYZ[i * 3 + 2] = xyz[i * 3 + 2];
            }
        }
    }

    (self as any).postMessage({ [WkActivePoints]: f32XYZ }, [f32XYZ.buffer]);
}

self.onmessage = (e: any) => {
    const data: any = e.data;
    if (data[WkSplatDataBuffer]) {
        setCommonParams(data[WkIsBigSceneMode], data[WkBinVersion], data[WkTopY], data[WkMaxRadius]);
        if (!uploadTexture(data[WkSplatDataBuffer], data[WkVersion], data[WkRenderSplatCount], data[WkVisibleSplatCount], data[WkModelSplatCount])) {
            (self as any).postMessage({ [WkUploadTextureVersion]: -1 });
        }
    } else if (data[WkTextureReady]) {
        if (texture0.version === data[WkVersion]) {
            texture0.textureReady = true;
            texture0.textureReadyTime = Date.now();
        } else if (texture1.version === data[WkVersion]) {
            texture1.textureReady = true;
            texture1.textureReadyTime = Date.now();
        }
        (self as any).postMessage({ [WkUploadTextureVersion]: data[WkVersion] });
    } else if (data[WkViewProjection]) {
        viewProj = data[WkViewProjection];
        throttledSort();
    } else if (data[WkMaxRenderCount]) {
        distances = new Int32Array(data[WkMaxRenderCount]);
    }
};
