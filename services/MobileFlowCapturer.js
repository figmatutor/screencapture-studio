const { remote } = require('webdriverio');
const fs = require('fs-extra');
const path = require('path');
const { execSync, spawn } = require('child_process');

class MobileFlowCapturer {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 60000,
      maxSteps: options.maxSteps || 20,
      screenshotDelay: options.screenshotDelay || 2000,
      ...options
    };
    
    this.driver = null;
    this.screenshots = [];
    this.currentStep = 0;
    this.platform = options.platform || 'android'; // 'android' or 'ios'
    this.deviceId = options.deviceId || null;
  }

  async initialize() {
    try {
      console.log(`🚀 ${this.platform.toUpperCase()} 모바일 자동화 초기화 중...`);

      if (this.platform === 'android') {
        await this.initializeAndroid();
      } else if (this.platform === 'ios') {
        await this.initializeIOS();
      }

      console.log('✅ 모바일 자동화 환경이 준비되었습니다.');
      return true;
    } catch (error) {
      console.error('❌ 모바일 자동화 초기화 실패:', error);
      throw error;
    }
  }

  async initializeAndroid() {
    // Android 디바이스 확인
    const devices = await this.getAndroidDevices();
    if (devices.length === 0) {
      throw new Error('연결된 Android 디바이스가 없습니다. USB 디버깅을 활성화하고 디바이스를 연결해주세요.');
    }

    this.deviceId = this.deviceId || devices[0];
    console.log(`📱 Android 디바이스 연결됨: ${this.deviceId}`);

    // Appium 설정
    const caps = {
      platformName: 'Android',
      deviceName: this.deviceId,
      automationName: 'UiAutomator2',
      noReset: true,
      fullReset: false,
      newCommandTimeout: this.options.timeout / 1000
    };

    // 앱이 지정된 경우
    if (this.options.appPackage) {
      caps.appPackage = this.options.appPackage;
      caps.appActivity = this.options.appActivity || '.MainActivity';
    }

    this.driver = await remote({
      hostname: 'localhost',
      port: 4723,
      path: '/wd/hub',
      capabilities: caps
    });
  }

  async initializeIOS() {
    // iOS 시뮬레이터 확인
    const simulators = await this.getIOSSimulators();
    if (simulators.length === 0) {
      throw new Error('사용 가능한 iOS 시뮬레이터가 없습니다.');
    }

    this.deviceId = this.deviceId || simulators[0].udid;
    console.log(`📱 iOS 시뮬레이터 연결됨: ${simulators[0].name}`);

    const caps = {
      platformName: 'iOS',
      deviceName: simulators[0].name,
      platformVersion: simulators[0].version,
      automationName: 'XCUITest',
      noReset: true,
      fullReset: false,
      newCommandTimeout: this.options.timeout / 1000
    };

    if (this.options.bundleId) {
      caps.bundleId = this.options.bundleId;
    }

    this.driver = await remote({
      hostname: 'localhost',
      port: 4723,
      path: '/wd/hub',
      capabilities: caps
    });
  }

  async getAndroidDevices() {
    try {
      const output = execSync('adb devices', { encoding: 'utf8' });
      const lines = output.split('\n').slice(1);
      const devices = lines
        .filter(line => line.includes('\tdevice'))
        .map(line => line.split('\t')[0]);
      
      return devices;
    } catch (error) {
      console.warn('ADB 명령어 실행 실패. Android Studio가 설치되고 ADB가 PATH에 있는지 확인하세요.');
      return [];
    }
  }

  async getIOSSimulators() {
    try {
      const output = execSync('xcrun simctl list devices available --json', { encoding: 'utf8' });
      const data = JSON.parse(output);
      
      const simulators = [];
      Object.keys(data.devices).forEach(version => {
        data.devices[version].forEach(device => {
          if (device.availability === '(available)' && device.state === 'Booted') {
            simulators.push({
              name: device.name,
              udid: device.udid,
              version: version.replace('iOS ', '')
            });
          }
        });
      });
      
      return simulators;
    } catch (error) {
      console.warn('iOS 시뮬레이터 조회 실패. Xcode가 설치되어 있는지 확인하세요.');
      return [];
    }
  }

  async captureFlowByScenario(scenario) {
    try {
      console.log(`📱 앱 플로우 캡처 시작: ${scenario.name}`);
      
      this.screenshots = [];
      this.currentStep = 0;

      // 초기 화면 캡처
      await this.captureScreenshot('initial_screen');

      // 시나리오 단계별 실행
      for (let i = 0; i < scenario.steps.length && i < this.options.maxSteps; i++) {
        const step = scenario.steps[i];
        console.log(`🎬 Step ${i + 1}: ${step.description}`);

        try {
          await this.executeStep(step);
          await this.sleep(this.options.screenshotDelay);
          await this.captureScreenshot(`step_${i + 1}_${step.action}`);
          this.currentStep++;
        } catch (error) {
          console.warn(`⚠️ Step ${i + 1} 실행 실패:`, error.message);
          await this.captureScreenshot(`step_${i + 1}_error`);
        }
      }

      // 최종 화면 캡처
      await this.captureScreenshot('final_screen');

      console.log(`✅ 앱 플로우 캡처 완료: ${this.screenshots.length}개 스크린샷`);
      
      return {
        success: true,
        scenario: scenario.name,
        screenshots: this.screenshots,
        totalSteps: this.currentStep + 1,
        platform: this.platform,
        deviceId: this.deviceId
      };

    } catch (error) {
      console.error('❌ 앱 플로우 캡처 실패:', error);
      throw error;
    }
  }

  async executeStep(step) {
    switch (step.action) {
      case 'tap':
        await this.tapElement(step.target);
        break;
      case 'input':
        await this.inputText(step.target, step.text);
        break;
      case 'swipe':
        await this.swipeScreen(step.direction, step.distance);
        break;
      case 'scroll':
        await this.scrollToElement(step.target);
        break;
      case 'wait':
        await this.sleep(step.duration || 2000);
        break;
      case 'back':
        await this.goBack();
        break;
      case 'home':
        await this.goHome();
        break;
      default:
        console.warn(`알 수 없는 액션: ${step.action}`);
    }
  }

  async tapElement(selector) {
    const element = await this.findElement(selector);
    await element.click();
    console.log(`👆 탭: ${selector.value || selector.xpath || selector.id}`);
  }

  async inputText(selector, text) {
    const element = await this.findElement(selector);
    await element.setValue(text);
    console.log(`⌨️ 텍스트 입력: ${text}`);
  }

  async swipeScreen(direction, distance = 0.5) {
    const { width, height } = await this.driver.getWindowSize();
    
    let startX, startY, endX, endY;
    
    switch (direction) {
      case 'up':
        startX = width / 2;
        startY = height * 0.8;
        endX = width / 2;
        endY = height * (0.8 - distance);
        break;
      case 'down':
        startX = width / 2;
        startY = height * 0.2;
        endX = width / 2;
        endY = height * (0.2 + distance);
        break;
      case 'left':
        startX = width * 0.8;
        startY = height / 2;
        endX = width * (0.8 - distance);
        endY = height / 2;
        break;
      case 'right':
        startX = width * 0.2;
        startY = height / 2;
        endX = width * (0.2 + distance);
        endY = height / 2;
        break;
    }

    await this.driver.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 1000, x: endX, y: endY },
        { type: 'pointerUp', button: 0 }
      ]
    }]);

    console.log(`👉 스와이프: ${direction}`);
  }

  async scrollToElement(selector) {
    try {
      const element = await this.findElement(selector);
      await this.driver.executeScript('mobile: scrollToElement', {
        element: element.elementId
      });
      console.log(`📜 스크롤: ${selector.value || selector.xpath || selector.id}`);
    } catch (error) {
      console.warn('스크롤 실패, 일반 스와이프로 대체');
      await this.swipeScreen('up', 0.3);
    }
  }

  async findElement(selector) {
    if (selector.id) {
      return await this.driver.$(`#${selector.id}`);
    } else if (selector.xpath) {
      return await this.driver.$(selector.xpath);
    } else if (selector.text) {
      return await this.driver.$(`*[text="${selector.text}"]`);
    } else if (selector.className) {
      return await this.driver.$(`.${selector.className}`);
    } else {
      throw new Error('지원하지 않는 셀렉터 타입입니다.');
    }
  }

  async goBack() {
    if (this.platform === 'android') {
      await this.driver.back();
    } else {
      // iOS는 네비게이션 바의 뒤로가기 버튼을 찾아서 탭
      try {
        const backButton = await this.driver.$('//XCUIElementTypeButton[@name="Back"]');
        await backButton.click();
      } catch {
        // 스와이프로 뒤로가기 시도
        await this.swipeScreen('right', 0.8);
      }
    }
    console.log('🔙 뒤로가기');
  }

  async goHome() {
    if (this.platform === 'android') {
      await this.driver.executeScript('mobile: pressKey', { keycode: 3 }); // HOME 키
    } else {
      await this.driver.executeScript('mobile: pressButton', { name: 'home' });
    }
    console.log('🏠 홈버튼');
  }

  async captureScreenshot(stepName) {
    try {
      const timestamp = Date.now();
      const filename = `${this.platform}_flow_${stepName}_${timestamp}.png`;
      const filepath = path.join(__dirname, '../screenshots', filename);
      
      await fs.ensureDir(path.dirname(filepath));
      
      const screenshot = await this.driver.takeScreenshot();
      await fs.writeFile(filepath, screenshot, 'base64');
      
      // 스크린샷 메타데이터 저장
      this.screenshots.push({
        filename,
        stepName,
        timestamp: new Date().toISOString(),
        step: this.currentStep,
        platform: this.platform,
        deviceId: this.deviceId
      });

      console.log(`📸 스크린샷 저장: ${filename}`);
      return filename;
    } catch (error) {
      console.error('스크린샷 캡처 실패:', error);
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.driver) {
      try {
        await this.driver.deleteSession();
        console.log('📱 모바일 세션 종료');
      } catch (error) {
        console.warn('세션 종료 중 오류:', error.message);
      }
      this.driver = null;
    }
  }

  // 사전 정의된 시나리오들
  static getPreDefinedScenarios() {
    return {
      'shopping_flow': {
        name: '쇼핑 앱 플로우',
        description: '상품 검색 → 상세보기 → 장바구니 → 결제',
        steps: [
          { action: 'tap', target: { id: 'search_button' }, description: '검색 버튼 탭' },
          { action: 'input', target: { id: 'search_input' }, text: '스마트폰', description: '검색어 입력' },
          { action: 'tap', target: { text: '검색' }, description: '검색 실행' },
          { action: 'wait', duration: 3000, description: '검색 결과 로딩 대기' },
          { action: 'tap', target: { className: 'product_item' }, description: '첫 번째 상품 선택' },
          { action: 'scroll', target: { text: '장바구니' }, description: '장바구니 버튼까지 스크롤' },
          { action: 'tap', target: { text: '장바구니' }, description: '장바구니 추가' },
          { action: 'tap', target: { id: 'cart_icon' }, description: '장바구니 보기' },
          { action: 'tap', target: { text: '주문하기' }, description: '주문 프로세스 시작' }
        ]
      },
      'social_app_flow': {
        name: '소셜 앱 플로우',
        description: '포스트 작성 → 사진 첨부 → 게시',
        steps: [
          { action: 'tap', target: { id: 'compose_button' }, description: '포스트 작성 버튼' },
          { action: 'input', target: { id: 'post_content' }, text: '오늘 날씨가 정말 좋네요!', description: '포스트 내용 입력' },
          { action: 'tap', target: { id: 'add_photo' }, description: '사진 추가' },
          { action: 'tap', target: { text: '카메라 롤' }, description: '갤러리 선택' },
          { action: 'tap', target: { className: 'photo_item' }, description: '사진 선택' },
          { action: 'tap', target: { text: '확인' }, description: '사진 확정' },
          { action: 'tap', target: { id: 'publish_button' }, description: '게시하기' }
        ]
      },
      'banking_app_flow': {
        name: '뱅킹 앱 플로우',
        description: '로그인 → 계좌조회 → 송금',
        steps: [
          { action: 'input', target: { id: 'user_id' }, text: 'demo_user', description: '아이디 입력' },
          { action: 'input', target: { id: 'password' }, text: '****', description: '비밀번호 입력' },
          { action: 'tap', target: { id: 'login_button' }, description: '로그인' },
          { action: 'wait', duration: 2000, description: '로그인 처리 대기' },
          { action: 'tap', target: { text: '계좌조회' }, description: '계좌조회 메뉴' },
          { action: 'tap', target: { text: '송금' }, description: '송금 메뉴' },
          { action: 'input', target: { id: 'account_number' }, text: '123-456-789', description: '받을 계좌번호 입력' },
          { action: 'input', target: { id: 'amount' }, text: '10000', description: '송금 금액 입력' },
          { action: 'tap', target: { text: '다음' }, description: '다음 단계' }
        ]
      }
    };
  }
}

module.exports = MobileFlowCapturer;

