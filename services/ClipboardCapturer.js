const puppeteer = require('puppeteer');
const sharp = require('sharp');
const clipboardy = require('clipboardy');
const fs = require('fs');
const path = require('path');

class ClipboardCapturer {
    constructor(options = {}) {
        this.options = {
            captureWidth: options.captureWidth || 1440,
            timeout: options.timeout || 30000,
            waitUntil: options.waitUntil || 'networkidle0',
            fullPage: options.fullPage !== false, // default true
            ...options
        };
        this.browser = null;
    }

    async initialize() {
        console.log('🚀 ClipboardCapturer 초기화 시작...');
        
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--window-size=1440,900'
            ],
            defaultViewport: {
                width: this.options.captureWidth,
                height: 900
            }
        });

        console.log('✅ 브라우저 초기화 완료');
    }

    async captureToClipboard(url) {
        console.log(`📸 클립보드 캡처 시작: ${url}`);
        
        if (!this.browser) {
            await this.initialize();
        }

        const page = await this.browser.newPage();
        
        try {
            // 페이지 설정
            await page.setViewport({
                width: this.options.captureWidth,
                height: 900
            });

            // 페이지 로드
            console.log('🌐 페이지 로딩 중...');
            await page.goto(url, {
                waitUntil: this.options.waitUntil,
                timeout: this.options.timeout
            });

            // 추가적인 렌더링 대기
            console.log('⏳ 렌더링 완료 대기 중...');
            
            // 폰트 로딩 대기
            await page.evaluate(() => {
                return document.fonts.ready;
            });

            // 이미지 로딩 대기
            await page.waitForFunction(() => {
                const images = Array.from(document.images);
                return images.every(img => img.complete);
            }, { timeout: 10000 }).catch(() => {
                console.log('⚠️ 일부 이미지 로딩 시간 초과 (계속 진행)');
            });

            // 페이지 스크롤로 lazy loading 트리거
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
                window.scrollTo(0, 0);
            });

            // 렌더링 안정화 대기
            await page.waitForTimeout(2000);

            console.log('📷 스크린샷 캡처 중...');
            
            // 전체 페이지 스크린샷 생성
            const screenshot = await page.screenshot({
                type: 'png',
                fullPage: this.options.fullPage,
                optimizeForSpeed: false
            });

            // 이미지 최적화 및 크기 조정
            const optimizedImage = await sharp(screenshot)
                .resize(this.options.captureWidth, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .png({ quality: 90 })
                .toBuffer();

            // 임시 파일로 저장 (클립보드 복사를 위해)
            const tempDir = path.join(__dirname, '../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFilePath = path.join(tempDir, `clipboard_${Date.now()}.png`);
            await fs.promises.writeFile(tempFilePath, optimizedImage);

            console.log('📋 클립보드에 복사 중...');
            
            // 클립보드에 이미지 복사
            await this.copyImageToClipboard(tempFilePath);

            // 임시 파일 정리
            setTimeout(() => {
                fs.unlink(tempFilePath, (err) => {
                    if (err) console.log('임시 파일 삭제 실패:', err);
                });
            }, 5000);

            console.log('✅ 클립보드 복사 완료!');

            return {
                success: true,
                message: '스크린샷이 클립보드에 복사되었습니다!',
                imageSize: optimizedImage.length,
                url: url,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ 캡처 실패:', error);
            throw error;
        } finally {
            await page.close();
        }
    }

    async copyImageToClipboard(imagePath) {
        try {
            // macOS/Linux에서 이미지를 클립보드에 복사
            if (process.platform === 'darwin') {
                // macOS
                const { execSync } = require('child_process');
                execSync(`osascript -e 'set the clipboard to (read (POSIX file "${imagePath}") as JPEG picture)'`);
            } else if (process.platform === 'linux') {
                // Linux (xclip 필요)
                const { execSync } = require('child_process');
                execSync(`xclip -selection clipboard -t image/png -i "${imagePath}"`);
            } else if (process.platform === 'win32') {
                // Windows (PowerShell 사용)
                const { execSync } = require('child_process');
                const powershellScript = `
                    Add-Type -AssemblyName System.Windows.Forms
                    Add-Type -AssemblyName System.Drawing
                    $img = [System.Drawing.Image]::FromFile("${imagePath}")
                    [System.Windows.Forms.Clipboard]::SetImage($img)
                    $img.Dispose()
                `;
                execSync(`powershell -Command "${powershellScript}"`);
            } else {
                throw new Error('지원되지 않는 운영체제입니다.');
            }
        } catch (error) {
            console.error('클립보드 복사 실패:', error);
            // 클립보드 복사가 실패해도 이미지는 저장됨
            throw new Error('클립보드 복사에 실패했습니다. 시스템 권한을 확인해주세요.');
        }
    }

    async captureAndSave(url, outputPath = null) {
        console.log(`📸 캡처 및 저장 시작: ${url}`);
        
        if (!this.browser) {
            await this.initialize();
        }

        const page = await this.browser.newPage();
        
        try {
            // 페이지 설정
            await page.setViewport({
                width: this.options.captureWidth,
                height: 900
            });

            // 페이지 로드
            console.log('🌐 페이지 로딩 중...');
            await page.goto(url, {
                waitUntil: this.options.waitUntil,
                timeout: this.options.timeout
            });

            // 렌더링 완료 대기
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(2000);

            console.log('📷 스크린샷 생성 중...');
            
            // 스크린샷 생성
            const screenshot = await page.screenshot({
                type: 'png',
                fullPage: this.options.fullPage,
                optimizeForSpeed: false
            });

            // 이미지 최적화
            const optimizedImage = await sharp(screenshot)
                .resize(this.options.captureWidth, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .png({ quality: 90 })
                .toBuffer();

            // 파일 저장
            if (outputPath) {
                await fs.promises.writeFile(outputPath, optimizedImage);
                console.log(`💾 이미지 저장 완료: ${outputPath}`);
            }

            return {
                success: true,
                imageBuffer: optimizedImage,
                imageSize: optimizedImage.length,
                url: url,
                outputPath: outputPath,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ 캡처 실패:', error);
            throw error;
        } finally {
            await page.close();
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            console.log('🔒 브라우저 종료 완료');
        }
    }
}

module.exports = ClipboardCapturer;
