// 由照片 + 四角算出腳部標記與量測值。主程式與測試頁共用這一段。
import { CONFIG } from './config.js';
import { rectify } from './paper.js';
import { rotateCorners } from './geometry.js';
import { segmentFoot, rotateSeg180 } from './foot.js';
import { autoMarkers, computeMeasurements } from './measure.js';

export function measureFromCorners(photo, corners, wantDebug = false) {
  const segPpm = CONFIG.SEG_PX_PER_MM;
  const segRect = rectify(photo, corners, segPpm).image;
  let seg = segmentFoot(segRect, segPpm, wantDebug);
  let flip = seg.heelSide === 'top';
  // 沒碰到任何短邊時，腳比較靠近哪條短邊就當作腳跟邊
  if (!seg.heelSide && seg.stat) flip = seg.stat.minY < seg.h - 1 - seg.stat.maxY;
  let finalCorners = corners;
  if (flip) {
    seg = rotateSeg180(seg);
    finalCorners = rotateCorners(corners, 2);
  }
  const { markers, flags } = autoMarkers(seg);
  const measurement = computeMeasurements(markers);
  return { seg, segRect, flip, corners: finalCorners, markers, flags, measurement };
}
