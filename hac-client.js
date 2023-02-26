const https = require('https');
const DomParser = require('dom-parser');
const qs = require("qs")
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const globalcfg = require('./config.json');
const fs = require('fs');
const AdmZip = require('adm-zip');

const parser = new DomParser();

class HACClient {
    constructor(config) {
        const jar = new CookieJar();

        this.instance = wrapper(axios.create({
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            jar
        }));

        this.name = config.name;
        this.baseUrl = config.baseUrl;
        this.csrfBeforeLoginUrl = this.baseUrl + globalcfg.constants.csrfbeforelogin;
        this.csrfAfterLoginUrl = this.baseUrl + globalcfg.constants.csrfafterlogin;
        this.loginUrl = this.baseUrl + globalcfg.constants.login;
        this.dataUrl = this.baseUrl + globalcfg.constants.data;
        this.zipUrl = this.baseUrl + globalcfg.constants.zip;
        this.downloadUrl = this.baseUrl + globalcfg.constants.download;

        this.username = config.credentials.username;
        this.password = config.credentials.password;

        this.csrfToken = ""
        this.files = []

        this.isLoggedIn = false;
    }

    log(message) {
        console.log(`[${this.name}]`.underline.blue + ' ' + message);
    }

    async getCsrf(url) {
        this.log(`Getting CSRF token..`.yellow);
        const csrfResponse = await this.instance({
            method: "GET",
            url: url
        });
        const dom = parser.parseFromString(csrfResponse.data);
        this.csrfToken = dom.getElementsByName("_csrf")[0].getAttribute("content");
        this.instance.defaults.headers.common['X-CSRF-TOKEN'] = this.csrfToken;
        this.log(`Got CSRF token [${this.csrfToken}]!`.green);
        return true;
    }

    async logIn() {
        await this.getCsrf(this.csrfBeforeLoginUrl);
        this.log(`Logging in..`.yellow);
        const loginResponse = await this.instance({
            method: "POST",
            url: this.loginUrl,
            data: qs.stringify({
                j_username: this.username,
                j_password: this.password,
                _csrf: this.csrfToken
            })
        });
        if (loginResponse.status != 200) {
            this.log(`Could not log in!`.red);
            return false;
        }
        this.log(`Successfully logged in!`.green);
        this.isLoggedIn = true;
        await this.getCsrf(this.csrfAfterLoginUrl);
        return true;
    }

    async getFiles() {
        if (!this.isLoggedIn) {
            await this.logIn();
        }

        this.log(`Getting file list...`.yellow);
        const fileListResponse = await this.instance({
            method: "GET",
            url: this.dataUrl
        });
        if (fileListResponse.status != 200) {
            this.log(`Could not get file list!`.red);
            return false;
        }
        this.files = fileListResponse.data.filter(file => file.size > 0);
        this.log(`Got file list with size [${this.files.length}]!`.green);
        return true;
    }

    searchFile(fileName) {
        const foundFiles = [];
        for (const file of this.files) {
            if (file.name.includes(fileName)) {
                foundFiles.push(file);
            }
        }
        this.log(`Found ${foundFiles.length} files: ${foundFiles.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}`.green)
        return foundFiles;
    }

    async downloadFile(fileName) {
        const files = this.searchFile(fileName);
        const filesString = files.map(file => file.absolute).join('|');
        let zipResponse = null;
        try {
            zipResponse = await this.instance({
                method: "POST",
                url: this.zipUrl,
                data: qs.stringify({
                    files: filesString
                })
            });
        } catch (e) {
            console.error(e);
        } finally {
            if (zipResponse == null || zipResponse.status !== 200) {
                this.log(`Error zipping ${files.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}!`.red)
                return;
            }
        }
        const size = zipResponse.data.size;
        this.log(`Zipped size is [${size}] of files: ${files.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}`.green);
        this.log(`Starting download...`.yellow);
        const fileStream = await this.instance({
            method: "GET",
            url: this.downloadUrl,
            responseType: 'stream'
        });
        const outputName = `${this.name}-${fileName}.zip`;
        const writeStream = fs.createWriteStream(outputName);
        await fileStream.data.pipe(writeStream);
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        this.log(`Download of [${outputName}] completed!`.green);
        const zip = new AdmZip(outputName);
        this.log(`Extracting [${outputName}]...`.green);
        zip.extractAllTo(`${this.name}_${fileName}`, true);
        this.log(`Extract of [${outputName}] completed, deleting the zip...`.green);
        //await fs.unlink(outputName);
        this.log(`All operations completed for [${outputName}]!`.green);
    }
}

module.exports = HACClient