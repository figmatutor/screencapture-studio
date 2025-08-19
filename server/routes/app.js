const express = require('express');
const AppStoreCrawler = require('../../services/AppStoreCrawler');
const URLValidator = require('../../utils/urlValidator');

const router = express.Router();
const appCrawlJobs = new Map();

// 앱스토어 스크린샷 크롤링 시작
router.post('/appstore', async (req, res) => {
  try {
    const { appStoreUrl, options = {} } = req.body;
    
    if (!appStoreUrl) {
      return res.status(400).json({
        success: false,
        error: '앱스토어 URL이 필요합니다.'
      });
    }

    // URL 유효성 검사
    const validation = URLValidator.validate(appStoreUrl);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // 앱스토어 URL 검증
    if (!appStoreUrl.includes('apps.apple.com') && 
        !appStoreUrl.includes('itunes.apple.com') && 
        !appStoreUrl.includes('play.google.com')) {
      return res.status(400).json({
        success: false,
        error: 'Apple App Store 또는 Google Play Store URL만 지원됩니다.'
      });
    }

    const jobId = Date.now().toString();
    
    // 크롤링 작업 시작
    const crawlJob = {
      id: jobId,
      url: appStoreUrl,
      status: 'running',
      startTime: new Date(),
      progress: 0
    };
    
    appCrawlJobs.set(jobId, crawlJob);

    // 비동기 크롤링 실행
    (async () => {
      const crawler = new AppStoreCrawler(options);
      
      try {
        await crawler.initialize();
        
        crawlJob.progress = 25;
        const result = await crawler.crawlAppStore(appStoreUrl);
        
        crawlJob.status = 'completed';
        crawlJob.progress = 100;
        crawlJob.result = result;
        crawlJob.endTime = new Date();
        
        console.log(`✅ 앱 크롤링 완료: ${jobId}`);
        
      } catch (error) {
        crawlJob.status = 'failed';
        crawlJob.error = error.message;
        crawlJob.endTime = new Date();
        
        console.error(`❌ 앱 크롤링 실패: ${jobId}`, error);
      } finally {
        await crawler.close();
      }
    })();

    res.json({
      success: true,
      jobId,
      message: '앱스토어 스크린샷 크롤링이 시작되었습니다.',
      statusUrl: `/api/app/status/${jobId}`
    });
    
  } catch (error) {
    console.error('앱 크롤링 API 오류:', error);
    res.status(500).json({
      success: false,
      error: '앱 크롤링 중 오류가 발생했습니다.'
    });
  }
});

// 크롤링 상태 확인
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = appCrawlJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: '작업을 찾을 수 없습니다.'
    });
  }
  
  res.json({
    success: true,
    job: {
      id: job.id,
      url: job.url,
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime,
      error: job.error
    }
  });
});

// 크롤링 결과 조회
router.get('/result/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = appCrawlJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: '작업을 찾을 수 없습니다.'
    });
  }
  
  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: '작업이 아직 완료되지 않았습니다.',
      status: job.status
    });
  }
  
  res.json({
    success: true,
    result: job.result
  });
});

// 앱 정보만 추출 (빠른 미리보기)
router.post('/info', async (req, res) => {
  try {
    const { appStoreUrl } = req.body;
    
    if (!appStoreUrl) {
      return res.status(400).json({
        success: false,
        error: '앱스토어 URL이 필요합니다.'
      });
    }

    const crawler = new AppStoreCrawler({ maxScreenshots: 0 }); // 스크린샷 제외, 정보만
    
    await crawler.initialize();
    const result = await crawler.crawlAppStore(appStoreUrl);
    await crawler.close();
    
    res.json({
      success: true,
      appInfo: result.appInfo
    });
    
  } catch (error) {
    console.error('앱 정보 추출 오류:', error);
    res.status(500).json({
      success: false,
      error: '앱 정보 추출 중 오류가 발생했습니다.'
    });
  }
});

// 지원되는 앱스토어 목록
router.get('/supported-stores', (req, res) => {
  res.json({
    success: true,
    supportedStores: [
      {
        name: 'Apple App Store',
        domains: ['apps.apple.com', 'itunes.apple.com'],
        example: 'https://apps.apple.com/kr/app/instagram/id389801252'
      },
      {
        name: 'Google Play Store',
        domains: ['play.google.com'],
        example: 'https://play.google.com/store/apps/details?id=com.instagram.android'
      }
    ]
  });
});

module.exports = router;
module.exports.appCrawlJobs = appCrawlJobs;

