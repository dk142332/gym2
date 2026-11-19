/**
 * Vercel Serverless Function: /api/analyze-equipment
 * - OpenRouter 비전 모델 호출 및 실제 에러 사유 직관적 반환
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `당신은 헬스장 초보자('헬린이')를 돕는 전문 피트니스 트레이너 AI입니다.
사용자가 업로드한 이미지를 분석하여 반드시 아래의 순수 JSON 형식으로만 응답하세요. 마크다운 코드 블록(\`\`\`json)이나 부가 설명 텍스트는 절대 포함하지 마세요.

1. 이미지가 헬스장 운동 기구가 아닌 경우:
{
  "is_gym_equipment": false,
  "message": "헬스장 머신 또는 운동 기구가 명확히 보이는 사진을 다시 촬영해 주세요."
}

2. 헬스장 기구가 맞을 경우 아래 스키마를 정확히 채워 반환하세요:
{
  "is_gym_equipment": true,
  "confidence_score": 0.95,
  "equipment": {
    "name_ko": "기구의 한국어 명칭",
    "name_en": "기구의 영어 명칭",
    "category": "머신 웨이트 또는 프리웨이트 또는 유산소",
    "primary_muscle": "가장 핵심이 되는 주 타겟 부위",
    "secondary_muscles": ["보조 근육 1", "보조 근육 2"],
    "difficulty": "초급 또는 중급",
    "setup_guide": ["세팅 방법 1", "세팅 방법 2"],
    "execution_guide": ["동작 순서 1", "동작 순서 2"],
    "beginner_cautions": ["주의사항 1", "주의사항 2"]
  }
}`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const configuredModel = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

  if (!apiKey) {
    return res.status(500).json({ error: 'Vercel 환경 변수 OPENROUTER_API_KEY가 비어 있습니다.' });
  }

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image/')) {
      return res.status(400).json({ error: '유효한 이미지 데이터가 전달되지 않았습니다.' });
    }

    const referer = req.headers.origin || 'https://gyms-ecru-alpha.vercel.app';

    // 설정한 모델을 최우선으로 시도하고, 혼잡/미지원 시 다른 무료 비전 모델들을 순차 시도
    const candidateModels = Array.from(
      new Set([
        configuredModel,
        'google/gemma-4-31b-it:free',
        'google/gemma-3-27b-it:free',
        'google/gemma-3-12b-it:free'
      ])
    );

    let lastStatus = 500;
    let lastRawError = '';
    let successData = null;

    for (const modelName of candidateModels) {
      const apiResponse = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': 'GymMate'
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: '이 사진 속 헬스장 기구를 분석해서 JSON으로 알려주세요.' },
                { type: 'image_url', image_url: { url: imageBase64 } }
              ]
            }
          ]
        })
      });

      if (apiResponse.ok) {
        successData = await apiResponse.json();
        break;
      }

      lastStatus = apiResponse.status;
      lastRawError = await apiResponse.text();
    }

    // 모든 모델이 실패한 경우, 가짜 문구 대신 OpenRouter가 보낸 실제 오류 사유를 그대로 표시
    if (!successData) {
      let detailMessage = lastRawError;
      try {
        const errJson = JSON.parse(lastRawError);
        detailMessage = errJson?.error?.message || lastRawError;
      } catch {
        // JSON이 아니면 원본 유지
      }

      return res.status(lastStatus).json({
        error: `[시도한 모델: ${configuredModel}] OpenRouter 오류(${lastStatus}): ${detailMessage}`
      });
    }

    const rawContent = successData?.choices?.[0]?.message?.content || '';
    const cleanedJsonStr = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsedResult = JSON.parse(cleanedJsonStr);
    return res.status(200).json(parsedResult);
  } catch (error) {
    return res.status(500).json({
      error: `서버 처리 오류: ${error.message}`
    });
  }
};