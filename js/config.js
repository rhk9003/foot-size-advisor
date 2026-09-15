// 所有門檻值集中在這裡，調參數只改這個檔案。
// 座標慣例：紙張座標單位 mm，x 由左到右 0~210，y 由上到下 0~297，
// 校正後腳跟固定在下緣 y=297，腳趾朝上。

export const CONFIG = {
  PAPER_W_MM: 210,
  PAPER_H_MM: 297,

  // 照片讀入
  WORK_MAX_SIDE: 2000,        // 讀入後長邊縮到這個像素
  DETECT_MAX_SIDE: 640,       // A4 偵測用縮圖長邊

  // 校正圖解析度
  RECT_PX_PER_MM: 4,          // 顯示與拖動標記用
  SEG_PX_PER_MM: 2,           // 腳部分割用

  // A4 偵測
  PAPER_MIN_AREA_RATIO: 0.06, // 紙在縮圖中至少佔的面積比例
  PAPER_THRESH_OFFSETS: [0, 10, 20, 32, 45, 60],
  PAPER_OPEN_RADIUS_PX: 2,
  PAPER_MIN_SCORE: 0.35,
  PAPER_WHITE_FLOOR_BORDER: 0.6, // 找不到紙時，畫面邊框超過 60% 是亮的就判定「地板太白」
  PAPER_ASPECT_TOL_AUTO: 0.12,   // 自動偵測長寬比容許 ±12%
  PAPER_ASPECT_TOL_MANUAL: 0.20, // 手動點角超過 ±20% 提示可能不是 A4
  DEFAULT_FOCAL_RATIO: 0.75,     // 手機主鏡頭焦距約等於長邊像素 × 0.75
  EDGE_REFINE_SAMPLES: 48,
  EDGE_REFINE_SEARCH_RATIO: 0.015, // 沿法線搜尋距離，佔對角線比例
  EDGE_REFINE_MIN_CONTRAST: 24,
  EDGE_REFINE_MAX_SHIFT_RATIO: 0.03,

  // 腳部分割
  SEG_EDGE_MARGIN_MM: 4,      // 紙邊內縮，避免角點誤差帶入地板
  SEG_HEEL_BAND_MM: 12,       // 判斷腳是否碰到腳跟邊的帶狀範圍
  SEG_REF_STRIP_MM: [6, 18],  // 取紙張參考色的長邊條帶（距紙邊）
  SEG_DARK_T: 0.42,           // 比紙暗超過 42% 視為腳或襪子
  SEG_CHROMA_T: 0.045,        // 色度偏離紙超過此值視為皮膚
  SEG_OPEN_MM: 1.5,
  SEG_CLOSE_MM: 3,
  SEG_MIN_AREA_MM2: 4000,

  // 量測
  WIDTH_ZONE: [0.55, 0.80],   // 從腳跟算起，腳寬量測區段佔腳長比例
  LENGTH_OFFSET_MM: 0,        // 系統性誤差修正，用實拍照片校正後再改
  WIDTH_OFFSET_MM: 0,
  FOOT_LENGTH_RANGE: [150, 300],
  FOOT_WIDTH_RANGE: [60, 140],
  CONFIDENCE_CONFIRM: 0.7,

  // 尺碼建議
  BOUNDARY_MM: 3,             // 離尺碼區間邊界 3mm 內同時列出相鄰尺碼
};
