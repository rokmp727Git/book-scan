/**
 * Google Drive API Service
 * Handles Google OAuth2 authentication via Google Identity Services (GIS),
 * searches or creates the target 'BOOK' folder, and uploads PDF/EPUB e-books.
 */

export class GoogleDriveService {
  constructor() {
    this.clientId = localStorage.getItem('gdrive_client_id') || '';
    this.gasUrl = localStorage.getItem('gdrive_gas_url') || '';
    this.accessToken = sessionStorage.getItem('gdrive_access_token') || '';
    this.tokenClient = null;
    this.cachedFolderId = null;
  }

  /**
   * Check if Google Identity Services script is loaded
   */
  static isGisLoaded() {
    return window.google && window.google.accounts && window.google.accounts.oauth2;
  }

  /**
   * Set and persist user's Google Client ID
   */
  setClientId(clientId) {
    this.clientId = (clientId || '').trim();
    localStorage.setItem('gdrive_client_id', this.clientId);
    this.tokenClient = null;
  }

  /**
   * Request OAuth2 token using Google Identity Services (GIS)
   */
  async requestAccessToken() {
    if (this.accessToken) {
      // Validate token with a quick ping
      try {
        const ping = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
        if (ping.ok) {
          return this.accessToken;
        }
      } catch (e) {
        // Token expired or invalid, will re-request below
      }
    }

    if (!this.clientId) {
      throw new Error('Google Cloud Client ID가 설정되지 않았습니다. [설정] 메뉴에서 Client ID를 입력하세요.');
    }

    if (!GoogleDriveService.isGisLoaded()) {
      throw new Error('Google Identity Services 라이브러리를 로드하는 중입니다. 잠시 후 다시 시도하세요.');
    }

    return new Promise((resolve, reject) => {
      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (tokenResponse) => {
            if (tokenResponse.error) {
              reject(new Error('Google 인증 실패: ' + tokenResponse.error));
              return;
            }
            this.accessToken = tokenResponse.access_token;
            sessionStorage.setItem('gdrive_access_token', this.accessToken);
            resolve(this.accessToken);
          },
          error_callback: (err) => {
            reject(new Error('Google OAuth 에러: ' + (err.message || err)));
          }
        });

        this.tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Finds or creates a folder named 'BOOK' in user's Google Drive
   * @param {string} token
   * @returns {Promise<string>} folderId
   */
  async getOrCreateBookFolder(token) {
    if (this.cachedFolderId) {
      // Verify cached folder exists
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${this.cachedFolderId}?fields=id,trashed`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (!data.trashed) return this.cachedFolderId;
        }
      } catch (e) {}
    }

    // 1. Search for existing folder named 'BOOK'
    const query = "name = 'BOOK' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, webViewLink)&spaces=drive`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!searchRes.ok) {
      throw new Error(`Google Drive 폴더 검색 실패 (${searchRes.status})`);
    }

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      this.cachedFolderId = searchData.files[0].id;
      return this.cachedFolderId;
    }

    // 2. Folder does not exist, create new folder 'BOOK'
    const createUrl = 'https://www.googleapis.com/drive/v3/files';
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'BOOK',
        mimeType: 'application/vnd.google-apps.folder',
        description: 'AI Video Book Scanner 자동 저장 폴더'
      })
    });

    if (!createRes.ok) {
      throw new Error(`Google Drive 'BOOK' 폴더 생성 실패 (${createRes.status})`);
    }

    const createdFolder = await createRes.json();
    this.cachedFolderId = createdFolder.id;
    return this.cachedFolderId;
  }

  /**
   * Uploads a file Blob directly into Google Drive 'BOOK' folder using multipart upload
   * @param {Blob} blob - file content
   * @param {string} filename - name of file
   * @param {string} mimeType - e.g. 'application/pdf' or 'application/epub+zip'
   * @param {Function} onProgress
   * @returns {Promise<{ id: string, name: string, webViewLink: string }>}
   */
  async uploadFileToBookFolder(blob, filename, mimeType, onProgress = null) {
    const token = await this.requestAccessToken();
    const folderId = await this.getOrCreateBookFolder(token);

    const metadata = {
      name: filename,
      mimeType: mimeType,
      parents: [folderId]
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const fileHeaderPart = `${delimiter}Content-Type: ${mimeType}\r\n\r\n`;

    const metadataBlob = new Blob([metadataPart], { type: 'text/plain' });
    const fileHeaderBlob = new Blob([fileHeaderPart], { type: 'text/plain' });
    const closeBlob = new Blob([closeDelimiter], { type: 'text/plain' });

    const multipartBody = new Blob([metadataBlob, fileHeaderBlob, blob, closeBlob], {
      type: `multipart/related; boundary=${boundary}`
    });

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: multipartBody
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Drive 파일 업로드 실패 (${response.status}): ${errText}`);
    }

    return await response.json();
  }

  /**
   * Set and persist Google Apps Script Web App URL
   */
  setGasUrl(gasUrl) {
    this.gasUrl = (gasUrl || '').trim();
    localStorage.setItem('gdrive_gas_url', this.gasUrl);
  }

  getGasUrl() {
    return this.gasUrl || localStorage.getItem('gdrive_gas_url') || '';
  }

  /**
   * Convert Blob to Base64 data string
   */
  async _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Check if running natively inside Google Apps Script iframe environment
   */
  isInsideGas() {
    return typeof google !== 'undefined' && Boolean(google && google.script && google.script.run);
  }

  /**
   * Upload file to Google Drive 'BOOK' folder via Google Apps Script (Native or Web App URL)
   */
  async uploadViaGas(blob, filename, mimeType) {
    const base64Data = await this._blobToBase64(blob);

    // 1. If running natively inside Google Apps Script (HTML served directly from GAS)
    if (this.isInsideGas()) {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler((res) => {
            if (res && res.status === 'success') {
              resolve({
                id: res.fileId,
                name: res.name,
                webViewLink: res.webViewLink
              });
            } else {
              reject(new Error((res && res.message) || '구글 드라이브 파일 저장 실패'));
            }
          })
          .withFailureHandler((err) => {
            reject(new Error('Google Apps Script 에러: ' + (err.message || err)));
          })
          .saveBookFiles({
            filename,
            mimeType,
            folderName: 'BOOK',
            base64: base64Data
          });
      });
    }

    // 2. If running on local/external server via GAS Web App URL
    const gasUrl = this.getGasUrl();
    if (!gasUrl) {
      throw new Error('Google Apps Script 웹 앱 URL이 설정되지 않았습니다.');
    }

    const payload = {
      filename,
      mimeType,
      folderName: 'BOOK',
      base64: base64Data
    };

    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Google Apps Script 서버 응답 오류 (${response.status})`);
    }

    const resData = await response.json();
    if (resData.status !== 'success') {
      throw new Error(resData.message || 'Google Apps Script 업로드 실패');
    }

    return {
      id: resData.fileId,
      name: resData.name,
      webViewLink: resData.webViewLink
    };
  }

  /**
   * Uploads both PDF and EPUB e-books to 'BOOK' folder
   * (Supports either Google Apps Script URL or Google OAuth Client ID)
   */
  async uploadEbookPackage({ pdfBlob, pdfFilename, epubBlob, epubFilename }, onProgressStep = null) {
    const results = [];
    const hasGas = this.isInsideGas() || Boolean(this.getGasUrl());

    // 1. Google Apps Script Mode (Zero complex OAuth config!)
    if (hasGas) {
      if (pdfBlob) {
        if (onProgressStep) onProgressStep('PDF를 Google Drive BOOK 폴더로 업로드 중...');
        const pdfRes = await this.uploadViaGas(pdfBlob, pdfFilename, 'application/pdf');
        results.push({ type: 'pdf', ...pdfRes });
      }

      if (epubBlob) {
        if (onProgressStep) onProgressStep('EPUB을 Google Drive BOOK 폴더로 업로드 중...');
        const epubRes = await this.uploadViaGas(epubBlob, epubFilename, 'application/epub+zip');
        results.push({ type: 'epub', ...epubRes });
      }

      return results;
    }

    // 2. Google Cloud OAuth GIS Mode
    if (pdfBlob) {
      if (onProgressStep) onProgressStep('PDF를 Google Drive BOOK 폴더로 업로드 중...');
      const pdfRes = await this.uploadFileToBookFolder(pdfBlob, pdfFilename, 'application/pdf');
      results.push({ type: 'pdf', ...pdfRes });
    }

    if (epubBlob) {
      if (onProgressStep) onProgressStep('EPUB을 Google Drive BOOK 폴더로 업로드 중...');
      const epubRes = await this.uploadFileToBookFolder(epubBlob, epubFilename, 'application/epub+zip');
      results.push({ type: 'epub', ...epubRes });
    }

    return results;
  }
}
