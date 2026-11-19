/**
 * GymMate 메인 클라이언트 스크립트
 * - SPA 화면 전환 (1단계 기구 인식 / 2단계 맞춤 루틴 / 3단계 기록)
 * - 1단계 이미지 리사이징 및 /api/analyze-equipment 서버리스 API 호출
 * - 기구 분석 결과 카드, 3단 가이드 탭, 2단계 루틴 연계 데이터 전달
 */

// 이미지 업로드 제약 상수 정의 (PRD_step1 FR-1.2, FR-1.3 기준)
const IMAGE_CONFIG = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 최대 10MB
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  MAX_DIMENSION_PX: 1280,                // 긴 변 기준 최대 1280px 리사이징
  JPEG_QUALITY: 0.82                     // 압축 품질
};

// 전역 상태 객체 (단계 간 데이터 공유용)
const appState = {
  currentView: 'view-step1',     // 현재 활성화된 뷰 ID
  selectedImageBase64: null,     // 리사이징 완료된 Base64 이미지 데이터 URL
  analyzedEquipment: null,       // 1단계에서 인식된 기구 JSON 데이터
  currentRoutine: null           // 2단계에서 생성된 루틴 JSON 데이터
};

/**
 * DOM 로드 완료 시 초기 이벤트 바인딩 수행
 */
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initImageUploadHandlers();
  console.log('[GymMate] 1단계 비전 분석 및 결과 UI 초기화 완료');
});

/**
 * 하단 탭 네비게이션 클릭 이벤트 초기화
 */
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetViewId = button.getAttribute('data-target');
      switchView(targetViewId);
    });
  });
}

/**
 * 지정된 뷰 ID로 화면을 전환하고 하단 탭 활성 상태를 갱신합니다.
 * @param {string} targetViewId - 활성화할 섹션의 DOM ID
 */
function switchView(targetViewId) {
  const sections = document.querySelectorAll('.view-section');
  sections.forEach((section) => {
    section.classList.add('hidden');
    section.classList.remove('active');
  });

  const targetSection = document.getElementById(targetViewId);
  if (targetSection) {
    targetSection.classList.remove('hidden');
    targetSection.classList.add('active');
    appState.currentView = targetViewId;
  }

  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach((btn) => {
    if (btn.getAttribute('data-target') === targetViewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * 1단계 이미지 선택, 변경, 삭제, 분석 요청 버튼 이벤트를 바인딩합니다.
 */
function initImageUploadHandlers() {
  const selectBtn = document.getElementById('btn-select-image');
  const reselectBtn = document.getElementById('btn-reselect-image');
  const removeBtn = document.getElementById('btn-remove-image');
  const analyzeBtn = document.getElementById('btn-analyze-equipment');
  const fileInput = document.getElementById('equipment-image-input');

  if (selectBtn && fileInput) {
    selectBtn.addEventListener('click', () => fileInput.click());
  }

  if (reselectBtn && fileInput) {
    reselectBtn.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleSelectedFile(file);
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      resetImageUploadState();
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      await requestEquipmentAnalysis();
    });
  }
}

/**
 * 선택된 이미지 파일의 유효성을 검사하고 리사이징 후 미리보기를 렌더링합니다.
 * @param {File} file - 사용자가 선택한 원본 이미지 File 객체
 */
async function handleSelectedFile(file) {
  hideUploadError();
  hideAnalysisResult();

  if (!IMAGE_CONFIG.ALLOWED_MIME_TYPES.includes(file.type)) {
    showUploadError('지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 이미지만 업로드해 주세요.');
    resetFileInput();
    return;
  }

  if (file.size > IMAGE_CONFIG.MAX_FILE_SIZE_BYTES) {
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    showUploadError(`파일 용량(${fileSizeMB}MB)이 너무 큽니다. 10MB 이하의 사진을 선택해 주세요.`);
    resetFileInput();
    return;
  }

  try {
    const resizedResult = await resizeImageToBase64(file);
    appState.selectedImageBase64 = resizedResult.base64DataUrl;
    renderImagePreview(resizedResult, file);
  } catch (error) {
    console.error('[GymMate] 이미지 처리 중 오류 발생:', error);
    showUploadError('이미지를 불러오는 중 문제가 발생했습니다. 다른 사진으로 다시 시도해 주세요.');
    resetFileInput();
  }
}

/**
 * HTML5 Canvas를 사용하여 이미지를 긴 변 최대 1280px로 리사이징하고 Base64로 반환합니다.
 * @param {File} file - 원본 이미지 파일
 */
function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        let targetWidth = img.width;
        let targetHeight = img.height;
        const maxDim = IMAGE_CONFIG.MAX_DIMENSION_PX;

        if (targetWidth > maxDim || targetHeight > maxDim) {
          if (targetWidth >= targetHeight) {
            targetHeight = Math.round((targetHeight * maxDim) / targetWidth);
            targetWidth = maxDim;
          } else {
            targetWidth = Math.round((targetWidth * maxDim) / targetHeight);
            targetHeight = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const base64DataUrl = canvas.toDataURL('image/jpeg', IMAGE_CONFIG.JPEG_QUALITY);
        const base64Body = base64DataUrl.split(',')[1] || '';
        const estimatedKB = Math.round((base64Body.length * 3) / 4 / 1024);

        resolve({
          base64DataUrl,
          width: targetWidth,
          height: targetHeight,
          estimatedKB
        });
      };

      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/**
 * 리사이징 완료된 이미지를 화면에 미리보기로 표시하고 버튼 상태를 전환합니다.
 */
function renderImagePreview(resizedResult, originalFile) {
  const uploadCard = document.getElementById('upload-dropzone');
  const placeholder = document.getElementById('upload-placeholder');
  const previewWrapper = document.getElementById('image-preview-wrapper');
  const previewImg = document.getElementById('equipment-preview-img');
  const metaInfo = document.getElementById('image-meta-info');
  const initialActions = document.getElementById('upload-initial-actions');
  const previewActions = document.getElementById('upload-preview-actions');

  previewImg.src = resizedResult.base64DataUrl;
  const originalKB = Math.round(originalFile.size / 1024);
  metaInfo.textContent = `최적화 완료: ${resizedResult.width}×${resizedResult.height}px (${originalKB}KB → 약 ${resizedResult.estimatedKB}KB)`;

  uploadCard.classList.add('has-image');
  placeholder.classList.add('hidden');
  previewWrapper.classList.remove('hidden');
  initialActions.classList.add('hidden');
  previewActions.classList.remove('hidden');
}

/**
 * 서버리스 API(/api/analyze-equipment)에 리사이징된 Base64 이미지를 전송해 분석을 요청합니다.
 */
async function requestEquipmentAnalysis() {
  if (!appState.selectedImageBase64) {
    showUploadError('먼저 헬스장 기구 사진을 선택해 주세요.');
    return;
  }

  hideUploadError();
  hideAnalysisResult();
  setAnalysisLoading(true);

  try {
    const response = await fetch('/api/analyze-equipment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageBase64: appState.selectedImageBase64
      })
    });

    const resultData = await response.json();

    if (!response.ok) {
      throw new Error(resultData.error || '기구 분석 요청에 실패했습니다.');
    }

    // 헬스장 기구가 아닌 이미지로 판별된 경우 예외 안내 (PRD_step1 섹션 6)
    if (resultData.is_gym_equipment === false) {
      showUploadError(
        resultData.message || '헬스장 머신 또는 운동 기구가 명확히 보이는 사진을 다시 촬영해 주세요.'
      );
      return;
    }

    // 정상 분석 결과 저장 및 화면 렌더링
    appState.analyzedEquipment = resultData.equipment;
    renderEquipmentResultCard(resultData.equipment);
  } catch (error) {
    console.error('[GymMate] AI 분석 요청 오류:', error);
    // file:// 프로토콜로 직접 열었을 때 안내 포함
    if (window.location.protocol === 'file:') {
      showUploadError('서버리스 API 실행을 위해 터미널에서 "npx vercel dev"로 로컬 서버를 실행해 주세요.');
    } else {
      showUploadError(error.message || '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  } finally {
    setAnalysisLoading(false);
  }
}

/**
 * 분석된 기구 정보를 바탕으로 요약 카드, 3단 가이드 탭, 2단계 연계 버튼을 렌더링합니다.
 * @param {Object} equipment - AI가 반환한 equipment 객체
 */
function renderEquipmentResultCard(equipment) {
  const container = document.getElementById('analysis-result-container');
  if (!container || !equipment) return;

  const secondaryBadgesHtml = (equipment.secondary_muscles || [])
    .map((muscle) => `<span class="muscle-badge muscle-secondary">+ ${escapeHtml(muscle)}</span>`)
    .join('');

  const setupListHtml = buildGuideListHtml(equipment.setup_guide);
  const executionListHtml = buildGuideListHtml(equipment.execution_guide);
  const cautionListHtml = buildGuideListHtml(equipment.beginner_cautions, true);

  container.innerHTML = `
    <article class="equipment-card">
      <div class="equipment-header">
        <div class="equipment-title-group">
          <h3>${escapeHtml(equipment.name_ko || '인식된 운동 기구')}</h3>
          <span class="equipment-en">${escapeHtml(equipment.name_en || '')} · ${escapeHtml(equipment.category || '웨이트')}</span>
        </div>
        <span class="badge-difficulty">${escapeHtml(equipment.difficulty || '초급')}</span>
      </div>

      <!-- 주동근 및 협응근 배지 -->
      <div class="muscle-tags">
        <span class="muscle-badge muscle-primary">🎯 주동근: ${escapeHtml(equipment.primary_muscle || '전신')}</span>
        ${secondaryBadgesHtml}
      </div>

      <!-- 3단 가이드 탭 메뉴 -->
      <div class="guide-tabs" role="tablist">
        <button type="button" class="guide-tab-btn active" data-tab="tab-setup">1. 머신 세팅법</button>
        <button type="button" class="guide-tab-btn" data-tab="tab-execution">2. 동작 가이드</button>
        <button type="button" class="guide-tab-btn" data-tab="tab-caution">3. 주의사항</button>
      </div>

      <!-- 탭 패널 1: 머신 세팅법 -->
      <div id="tab-setup" class="guide-panel">
        <ul class="guide-list">${setupListHtml}</ul>
      </div>

      <!-- 탭 패널 2: 운동 동작 가이드 -->
      <div id="tab-execution" class="guide-panel hidden">
        <ul class="guide-list">${executionListHtml}</ul>
      </div>

      <!-- 탭 패널 3: 헬린이 주의사항 -->
      <div id="tab-caution" class="guide-panel hidden">
        <ul class="guide-list caution-list">${cautionListHtml}</ul>
      </div>

      <!-- 2단계 연계 CTA 버튼 -->
      <button type="button" class="btn btn-primary" id="btn-go-step2">
        📋 이 기구로 맞춤 루틴 만들기
      </button>
    </article>
  `;

  container.classList.remove('hidden');

  // 결과 카드 내 탭 전환 및 2단계 이동 이벤트 연결
  bindResultCardEvents(equipment);

  // 결과 카드로 부드럽게 스크롤 이동
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * 가이드 항목 배열을 번호가 매겨진 <li> HTML 문자열로 변환합니다.
 */
function buildGuideListHtml(items = [], isCaution = false) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<li><span>제공된 안내 항목이 없습니다.</span></li>';
  }
  return items
    .map(
      (text, idx) => `
      <li>
        <span class="guide-step-num">${isCaution ? '!' : idx + 1}</span>
        <span>${escapeHtml(text)}</span>
      </li>
    `
    )
    .join('');
}

/**
 * 렌더링된 기구 결과 카드 내부의 가이드 탭 전환 및 2단계 이동 버튼 이벤트를 바인딩합니다.
 */
function bindResultCardEvents(equipment) {
  const tabButtons = document.querySelectorAll('.guide-tab-btn');
  const tabPanels = document.querySelectorAll('.guide-panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');

      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      tabPanels.forEach((panel) => {
        if (panel.id === targetTabId) {
          panel.classList.remove('hidden');
        } else {
          panel.classList.add('hidden');
        }
      });
    });
  });

  const goStep2Btn = document.getElementById('btn-go-step2');
  if (goStep2Btn) {
    goStep2Btn.addEventListener('click', () => {
      // 2단계 상단 배너에 선택된 기구 정보 전달 후 화면 전환
      const step2Banner = document.getElementById('step2-selected-equipment-banner');
      if (step2Banner) {
        step2Banner.textContent = `✅ 선택된 메인 기구: ${equipment.name_ko} (${equipment.primary_muscle})`;
        step2Banner.classList.remove('hidden');
      }
      switchView('view-step2');
    });
  }
}

/**
 * 분석 중 로딩 UI 및 버튼 비활성화 상태를 제어합니다.
 */
function setAnalysisLoading(isLoading) {
  const loadingEl = document.getElementById('analysis-loading');
  const analyzeBtn = document.getElementById('btn-analyze-equipment');
  const reselectBtn = document.getElementById('btn-reselect-image');

  if (loadingEl) {
    loadingEl.classList.toggle('hidden', !isLoading);
  }
  if (analyzeBtn) {
    analyzeBtn.disabled = isLoading;
    analyzeBtn.textContent = isLoading ? '분석 중...' : '🔍 AI 기구 분석하기';
  }
  if (reselectBtn) {
    reselectBtn.disabled = isLoading;
  }
}

/**
 * 선택된 이미지와 미리보기 UI, 분석 결과를 모두 초기화합니다.
 */
function resetImageUploadState() {
  appState.selectedImageBase64 = null;
  appState.analyzedEquipment = null;
  resetFileInput();
  hideUploadError();
  hideAnalysisResult();

  const uploadCard = document.getElementById('upload-dropzone');
  const placeholder = document.getElementById('upload-placeholder');
  const previewWrapper = document.getElementById('image-preview-wrapper');
  const previewImg = document.getElementById('equipment-preview-img');
  const initialActions = document.getElementById('upload-initial-actions');
  const previewActions = document.getElementById('upload-preview-actions');

  previewImg.src = '';
  uploadCard.classList.remove('has-image');
  placeholder.classList.remove('hidden');
  previewWrapper.classList.add('hidden');
  initialActions.classList.remove('hidden');
  previewActions.classList.add('hidden');
}

function resetFileInput() {
  const fileInput = document.getElementById('equipment-image-input');
  if (fileInput) fileInput.value = '';
}

function showUploadError(message) {
  const errorBanner = document.getElementById('upload-error-banner');
  if (errorBanner) {
    errorBanner.textContent = `⚠️ ${message}`;
    errorBanner.classList.remove('hidden');
  }
}

function hideUploadError() {
  const errorBanner = document.getElementById('upload-error-banner');
  if (errorBanner) {
    errorBanner.textContent = '';
    errorBanner.classList.add('hidden');
  }
}

function hideAnalysisResult() {
  const container = document.getElementById('analysis-result-container');
  if (container) {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
}

/**
 * XSS 방지를 위한 간단한 HTML 이스케이프 헬퍼 함수
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}