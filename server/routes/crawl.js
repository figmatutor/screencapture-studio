const express = require('express');
const FlowCrawler = require('../../services/FlowCrawler');
const URLValidator = require('../../utils/urlValidator');
const router = express.Router();

// 크롤링 작업 저장소 (실제 운영에서는 Redis나 DB 사용)
const crawlJobs = new Map();

// 다른 모듈에서 접근할 수 있도록 export
module.exports.crawlJobs = crawlJobs;

// 기본 프롬프트: URL 입력 시 전체 플로우 캡처
router.post('/basic', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL을 입력해주세요.'
      });
    }

    // 작업 ID 생성
    const jobId = generateJobId();
    
    // 크롤링 작업 상태 초기화
    crawlJobs.set(jobId, {
      status: 'starting',
      progress: 0,
      message: '크롤링 준비 중...',
      startTime: new Date(),
      url
    });

    // 비동기로 크롤링 실행
    executeCrawling(jobId, url);

    res.json({
      success: true,
      jobId,
      message: '크롤링이 시작되었습니다.',
      statusUrl: `/api/crawl/status/${jobId}`
    });

  } catch (error) {
    console.error('기본 크롤링 요청 오류:', error);
    res.status(500).json({
      error: '크롤링 요청 처리 중 오류가 발생했습니다.'
    });
  }
});

// 빠른 캡처 모드: 최적화된 고속 캡처
router.post('/fast', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL을 입력해주세요.'
      });
    }

    // 작업 ID 생성
    const jobId = generateJobId();
    
    // 크롤링 작업 상태 초기화
    crawlJobs.set(jobId, {
      status: 'starting',
      progress: 0,
      message: '빠른 크롤링 준비 중...',
      startTime: new Date(),
      url
    });

    // 비동기로 고속 크롤링 실행
    executeFastCrawling(jobId, url);

    res.json({
      success: true,
      jobId,
      message: '고속 크롤링이 시작되었습니다.',
      statusUrl: `/api/crawl/status/${jobId}`,
      estimatedTime: '약 3-5초 예상'
    });

  } catch (error) {
    console.error('고속 크롤링 요청 오류:', error);
    res.status(500).json({
      error: '고속 크롤링 요청 처리 중 오류가 발생했습니다.'
    });
  }
});

// 확장 프롬프트: 사용자 맞춤형 캡처 기능
router.post('/advanced', async (req, res) => {
  try {
    const { 
      url, 
      viewport = 'desktop',
      ignoreUrls = [],
      loginInfo = null,
      maxPages = 20,
      maxDepth = 3,
      fastMode = false
    } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL을 입력해주세요.'
      });
    }

    // URL 유효성 검사
    const validation = URLValidator.validate(url);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'URL 유효성 검사 실패',
        details: validation.errors
      });
    }

    // robots.txt 확인 (선택적)
    const robotsCheck = await URLValidator.checkRobotsPermission(validation.normalizedUrl);
    if (!robotsCheck.allowed) {
      console.warn(`⚠️ robots.txt에서 크롤링 제한: ${url}`);
    }

    // 뷰포트 설정
    const viewportConfig = getViewportConfig(viewport);
    
    // 작업 ID 생성
    const jobId = generateJobId();
    
    // 크롤링 옵션 구성
    const crawlOptions = {
      maxPages,
      maxDepth,
      viewport: viewportConfig,
      ignorePatterns: ignoreUrls,
      loginCredentials: loginInfo,
      fastMode // 사용자 지정 fastMode 옵션
    };

    // 크롤링 작업 상태 초기화
    crawlJobs.set(jobId, {
      status: 'starting',
      progress: 0,
      message: '고급 크롤링 준비 중...',
      startTime: new Date(),
      url,
      options: crawlOptions
    });

    // 비동기로 크롤링 실행 (정규화된 URL 사용)
    executeAdvancedCrawling(jobId, validation.normalizedUrl, crawlOptions);

    res.json({
      success: true,
      jobId,
      message: '고급 크롤링이 시작되었습니다.',
      statusUrl: `/api/crawl/status/${jobId}`,
      options: crawlOptions
    });

  } catch (error) {
    console.error('고급 크롤링 요청 오류:', error);
    res.status(500).json({
      error: '고급 크롤링 요청 처리 중 오류가 발생했습니다.'
    });
  }
});

// 특정 플로우 지정 캡처
router.post('/specific-flow', async (req, res) => {
  try {
    const { 
      startUrl, 
      endCondition,
      endConditionType = 'text' // 'text' | 'url' | 'selector'
    } = req.body;

    if (!startUrl || !endCondition) {
      return res.status(400).json({
        error: '시작 URL과 종료 조건을 모두 입력해주세요.'
      });
    }

    const jobId = generateJobId();
    
    crawlJobs.set(jobId, {
      status: 'starting',
      progress: 0,
      message: '특정 플로우 크롤링 준비 중...',
      startTime: new Date(),
      startUrl,
      endCondition,
      endConditionType
    });

    // 특정 플로우 크롤링 실행
    executeSpecificFlowCrawling(jobId, startUrl, endCondition, endConditionType);

    res.json({
      success: true,
      jobId,
      message: '특정 플로우 크롤링이 시작되었습니다.',
      statusUrl: `/api/crawl/status/${jobId}`
    });

  } catch (error) {
    console.error('특정 플로우 크롤링 요청 오류:', error);
    res.status(500).json({
      error: '특정 플로우 크롤링 요청 처리 중 오류가 발생했습니다.'
    });
  }
});

// 크롤링 상태 조회
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = crawlJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: '해당 작업을 찾을 수 없습니다.'
    });
  }

  res.json(job);
});

// 크롤링 결과 조회
router.get('/result/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = crawlJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: '해당 작업을 찾을 수 없습니다.'
    });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({
      error: '크롤링이 아직 완료되지 않았습니다.',
      status: job.status
    });
  }

  res.json({
    success: true,
    jobId,
    result: job.result,
    downloadLinks: {
      pdf: `/api/export/pdf/${jobId}`,
      zip: `/api/export/zip/${jobId}`
    }
  });
});

// 작업 취소
router.post('/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = crawlJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: '해당 작업을 찾을 수 없습니다.'
    });
  }

  if (job.status === 'completed' || job.status === 'cancelled') {
    return res.status(400).json({
      error: '이미 완료되거나 취소된 작업입니다.'
    });
  }

  job.status = 'cancelled';
  job.message = '사용자에 의해 취소됨';
  job.endTime = new Date();

  res.json({
    success: true,
    message: '크롤링 작업이 취소되었습니다.'
  });
});

// 유틸리티 함수들
function generateJobId() {
  return 'job_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

function getViewportConfig(viewport) {
  const configs = {
    desktop: { width: 1920, height: 1080 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 667 }
  };
  return configs[viewport] || configs.desktop;
}

// 기본 크롤링 실행
async function executeCrawling(jobId, url) {
  const job = crawlJobs.get(jobId);
  
  // 전체 작업 타임아웃 설정 (3분)
  const timeout = setTimeout(() => {
    if (job.status === 'running') {
      job.status = 'failed';
      job.message = '크롤링 타임아웃 (3분 초과)';
      job.error = 'timeout';
      job.endTime = new Date();
      console.log(`⏰ 크롤링 타임아웃 (${jobId})`);
    }
  }, 180000); // 3분
  
  try {
    job.status = 'running';
    job.message = '웹사이트 분석 중...';
    job.progress = 10;

    const crawler = new FlowCrawler({
      maxPages: 10, // 페이지 수 제한
      maxDepth: 2,  // 깊이 제한
      timeout: 10000, // 개별 페이지 타임아웃
      fastMode: true // FAST_MODE 활성화
    });

    job.message = '페이지 크롤링 시작...';
    job.progress = 30;

    const result = await crawler.crawlWebsite(url);

    clearTimeout(timeout); // 성공 시 타임아웃 해제
    
    job.status = 'completed';
    job.message = '크롤링 완료!';
    job.progress = 100;
    job.result = result;
    job.endTime = new Date();

    console.log(`✅ 크롤링 완료 (${jobId}): ${result.totalPages}개 페이지`);

  } catch (error) {
    clearTimeout(timeout); // 실패 시 타임아웃 해제
    console.error(`❌ 크롤링 실패 (${jobId}):`, error);
    
    job.status = 'failed';
    job.message = `크롤링 실패: ${error.message}`;
    job.error = error.message;
    job.endTime = new Date();
  }
}

// 고급 크롤링 실행
async function executeAdvancedCrawling(jobId, url, options) {
  const job = crawlJobs.get(jobId);
  
  try {
    job.status = 'running';
    job.message = '고급 옵션으로 크롤링 중...';
    job.progress = 20;

    const crawler = new FlowCrawler(options);
    
    job.progress = 40;
    const result = await crawler.crawlWebsite(url, options.loginCredentials);

    job.status = 'completed';
    job.message = '고급 크롤링 완료!';
    job.progress = 100;
    job.result = result;
    job.endTime = new Date();

  } catch (error) {
    console.error(`❌ 고급 크롤링 실패 (${jobId}):`, error);
    
    job.status = 'failed';
    job.message = `고급 크롤링 실패: ${error.message}`;
    job.error = error.message;
    job.endTime = new Date();
  }
}

// 고속 크롤링 실행
async function executeFastCrawling(jobId, url) {
  const job = crawlJobs.get(jobId);
  
  // 전체 작업 타임아웃 설정 (30초)
  const timeout = setTimeout(() => {
    if (job.status === 'running') {
      job.status = 'failed';
      job.message = '고속 크롤링 타임아웃 (30초 초과)';
      job.error = 'timeout';
      job.endTime = new Date();
      console.log(`⏰ 고속 크롤링 타임아웃 (${jobId})`);
    }
  }, 30000); // 30초
  
  try {
    job.status = 'running';
    job.message = '고속 페이지 분석 중...';
    job.progress = 20;

    const crawler = new FlowCrawler({
      maxPages: 5, // 페이지 수 더 제한
      maxDepth: 1,  // 깊이 최소화
      timeout: 20000, // 충분한 로딩 시간 제공
      fastMode: true, // FAST_MODE 활성화 (선별적 리소스 차단)
      fullPageCapture: true, // 전체 페이지 캡처
      viewport: { width: 1280, height: 720 } // 최적화된 뷰포트
    });

    job.message = '고속 페이지 크롤링 중...';
    job.progress = 50;

    const result = await crawler.crawlWebsite(url);

    clearTimeout(timeout); // 성공 시 타임아웃 해제
    
    job.status = 'completed';
    job.message = '고속 크롤링 완료!';
    job.progress = 100;
    job.result = result;
    job.endTime = new Date();

    const duration = (job.endTime - job.startTime) / 1000;
    console.log(`⚡ 고속 크롤링 완료 (${jobId}): ${result.totalPages}개 페이지, ${duration.toFixed(1)}초`);

  } catch (error) {
    clearTimeout(timeout); // 실패 시 타임아웃 해제
    console.error(`❌ 고속 크롤링 실패 (${jobId}):`, error);
    
    job.status = 'failed';
    job.message = `고속 크롤링 실패: ${error.message}`;
    job.error = error.message;
    job.endTime = new Date();
  }
}

// 특정 플로우 크롤링 실행
async function executeSpecificFlowCrawling(jobId, startUrl, endCondition, endConditionType) {
  const job = crawlJobs.get(jobId);
  
  try {
    job.status = 'running';
    job.message = '특정 플로우 크롤링 중...';
    job.progress = 30;

    // 특정 플로우를 위한 특별한 크롤러 옵션
    const crawler = new FlowCrawler({
      maxPages: 10,
      maxDepth: 5,
      endCondition,
      endConditionType
    });
    
    const result = await crawler.crawlWebsite(startUrl);

    job.status = 'completed';
    job.message = '특정 플로우 크롤링 완료!';
    job.progress = 100;
    job.result = result;
    job.endTime = new Date();

  } catch (error) {
    console.error(`❌ 특정 플로우 크롤링 실패 (${jobId}):`, error);
    
    job.status = 'failed';
    job.message = `특정 플로우 크롤링 실패: ${error.message}`;
    job.error = error.message;
    job.endTime = new Date();
  }
}

// 라우터와 crawlJobs를 함께 export
router.crawlJobs = crawlJobs;
module.exports = router;
