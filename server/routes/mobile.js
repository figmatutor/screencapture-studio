const express = require('express');
const MobileFlowCapturer = require('../../services/MobileFlowCapturer');

const router = express.Router();
const mobileFlowJobs = new Map();

// 연결된 디바이스 조회
router.get('/devices', async (req, res) => {
  try {
    const capturer = new MobileFlowCapturer();
    
    const androidDevices = await capturer.getAndroidDevices();
    const iosSimulators = await capturer.getIOSSimulators();
    
    res.json({
      success: true,
      devices: {
        android: androidDevices.map(device => ({
          id: device,
          platform: 'android',
          name: `Android Device (${device})`
        })),
        ios: iosSimulators.map(sim => ({
          id: sim.udid,
          platform: 'ios',
          name: `${sim.name} (iOS ${sim.version})`
        }))
      }
    });
  } catch (error) {
    console.error('디바이스 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '디바이스 조회 중 오류가 발생했습니다.'
    });
  }
});

// 사전 정의된 시나리오 목록
router.get('/scenarios', (req, res) => {
  const scenarios = MobileFlowCapturer.getPreDefinedScenarios();
  
  res.json({
    success: true,
    scenarios: Object.keys(scenarios).map(key => ({
      id: key,
      name: scenarios[key].name,
      description: scenarios[key].description,
      stepsCount: scenarios[key].steps.length
    }))
  });
});

// 특정 시나리오 상세 정보
router.get('/scenarios/:scenarioId', (req, res) => {
  const { scenarioId } = req.params;
  const scenarios = MobileFlowCapturer.getPreDefinedScenarios();
  
  if (!scenarios[scenarioId]) {
    return res.status(404).json({
      success: false,
      error: '시나리오를 찾을 수 없습니다.'
    });
  }
  
  res.json({
    success: true,
    scenario: scenarios[scenarioId]
  });
});

// 모바일 플로우 캡처 시작
router.post('/capture', async (req, res) => {
  try {
    const { 
      platform, 
      deviceId, 
      scenarioId, 
      customScenario,
      appPackage, 
      appActivity,
      bundleId,
      options = {} 
    } = req.body;
    
    if (!platform || (platform !== 'android' && platform !== 'ios')) {
      return res.status(400).json({
        success: false,
        error: '플랫폼을 지정해주세요 (android 또는 ios).'
      });
    }

    // 시나리오 결정
    let scenario;
    if (customScenario) {
      scenario = customScenario;
    } else if (scenarioId) {
      const preDefinedScenarios = MobileFlowCapturer.getPreDefinedScenarios();
      scenario = preDefinedScenarios[scenarioId];
      if (!scenario) {
        return res.status(400).json({
          success: false,
          error: '존재하지 않는 시나리오입니다.'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: '시나리오를 지정해주세요.'
      });
    }

    const jobId = Date.now().toString();
    
    const captureJob = {
      id: jobId,
      platform,
      deviceId,
      scenario: scenario.name,
      status: 'initializing',
      startTime: new Date(),
      progress: 0
    };
    
    mobileFlowJobs.set(jobId, captureJob);

    // 비동기 플로우 캡처 실행
    (async () => {
      const capturer = new MobileFlowCapturer({
        platform,
        deviceId,
        appPackage,
        appActivity,
        bundleId,
        ...options
      });
      
      try {
        captureJob.status = 'connecting';
        captureJob.progress = 10;
        
        await capturer.initialize();
        
        captureJob.status = 'capturing';
        captureJob.progress = 30;
        
        const result = await capturer.captureFlowByScenario(scenario);
        
        captureJob.status = 'completed';
        captureJob.progress = 100;
        captureJob.result = result;
        captureJob.endTime = new Date();
        
        console.log(`✅ 모바일 플로우 캡처 완료: ${jobId}`);
        
      } catch (error) {
        captureJob.status = 'failed';
        captureJob.error = error.message;
        captureJob.endTime = new Date();
        
        console.error(`❌ 모바일 플로우 캡처 실패: ${jobId}`, error);
      } finally {
        await capturer.close();
      }
    })();

    res.json({
      success: true,
      jobId,
      message: '모바일 앱 플로우 캡처가 시작되었습니다.',
      statusUrl: `/api/mobile/status/${jobId}`,
      scenario: scenario.name
    });
    
  } catch (error) {
    console.error('모바일 플로우 캡처 API 오류:', error);
    res.status(500).json({
      success: false,
      error: '모바일 플로우 캡처 중 오류가 발생했습니다.'
    });
  }
});

// 캡처 상태 확인
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = mobileFlowJobs.get(jobId);
  
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
      platform: job.platform,
      deviceId: job.deviceId,
      scenario: job.scenario,
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime,
      error: job.error
    }
  });
});

// 캡처 결과 조회
router.get('/result/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = mobileFlowJobs.get(jobId);
  
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

// 커스텀 시나리오 업로드
router.post('/scenario/upload', (req, res) => {
  try {
    const { name, description, steps } = req.body;
    
    if (!name || !steps || !Array.isArray(steps)) {
      return res.status(400).json({
        success: false,
        error: '시나리오 이름과 단계가 필요합니다.'
      });
    }

    // 단계 유효성 검사
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.action || !step.description) {
        return res.status(400).json({
          success: false,
          error: `Step ${i + 1}: action과 description은 필수입니다.`
        });
      }
    }

    const scenarioId = name.toLowerCase().replace(/\s+/g, '_');
    
    res.json({
      success: true,
      scenarioId,
      message: '커스텀 시나리오가 업로드되었습니다.',
      scenario: { name, description, steps }
    });
    
  } catch (error) {
    console.error('시나리오 업로드 오류:', error);
    res.status(500).json({
      success: false,
      error: '시나리오 업로드 중 오류가 발생했습니다.'
    });
  }
});

// Appium 서버 상태 확인
router.get('/appium/status', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    
    // Appium 서버가 실행 중인지 확인
    const checkAppium = spawn('curl', ['-s', 'http://localhost:4723/wd/hub/status']);
    
    let output = '';
    checkAppium.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    checkAppium.on('close', (code) => {
      if (code === 0 && output.includes('ready')) {
        res.json({
          success: true,
          status: 'running',
          message: 'Appium 서버가 실행 중입니다.'
        });
      } else {
        res.json({
          success: false,
          status: 'stopped',
          message: 'Appium 서버가 실행되지 않고 있습니다. `appium` 명령어로 서버를 시작해주세요.'
        });
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Appium 서버 상태 확인 중 오류가 발생했습니다.'
    });
  }
});

// 설치 가이드
router.get('/setup-guide', (req, res) => {
  res.json({
    success: true,
    guide: {
      requirements: [
        'Node.js (v14 이상)',
        'Java Development Kit (JDK 8 이상)',
        'Android Studio (Android 개발용)',
        'Xcode (iOS 개발용, macOS만)',
        'Appium Server'
      ],
      installation: [
        '1. npm install -g appium',
        '2. appium driver install uiautomator2 (Android용)',
        '3. appium driver install xcuitest (iOS용)',
        '4. Android Studio에서 Android SDK 설치',
        '5. 환경변수 설정: ANDROID_HOME, JAVA_HOME'
      ],
      usage: [
        '1. 디바이스 연결 및 USB 디버깅 활성화',
        '2. appium 명령어로 서버 시작',
        '3. Flow Screenshot에서 모바일 플로우 캡처 실행'
      ]
    }
  });
});

module.exports = router;
module.exports.mobileFlowJobs = mobileFlowJobs;

