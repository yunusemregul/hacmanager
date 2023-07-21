const https = require('https');
const DomParser = require('dom-parser');
const qs = require("qs")
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const globalcfg = require('./config.json');
const fs = require('fs');
const path = require("path");
const ProgressBar = require('progress');
const { execSync } = require('child_process');

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


        // TODO: this looks messy
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
            url: url,
            timeout: 3000
        });
        const dom = parser.parseFromString(csrfResponse.data);
        this.csrfToken = dom.getElementsByName("_csrf")[0].getAttribute("content");
        this.instance.defaults.headers.common['X-CSRF-TOKEN'] = this.csrfToken;
        this.log(`Got CSRF token [${this.csrfToken}]!`.green);
        return true;
    }

    async logIn() {
        try {
            await this.getCsrf(this.csrfBeforeLoginUrl);
        } catch (error) {
            this.log(`Error getting CSRF token, client ${this.name} wont work!`.red)
            return false;
        }
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

        if (this.isLoggedIn) {
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
    }

    searchFile(fileName) {
        const foundFiles = [];
        for (const file of this.files) {
            if (file.name.match(fileName)) {
                foundFiles.push(file);
            }
        }
        this.log(`Found ${foundFiles.length} files: ${foundFiles.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}`.green)
        return foundFiles;
    }

    // todo: test if this works properly with multiple files
    async downloadFile(fileName) {
        let files = this.searchFile(fileName);

        const downloadPath = this.getDownloadPath(fileName);
        if (fs.existsSync(downloadPath)) {
            const downloadedLogs = fs.readdirSync(downloadPath)
            for (const log of downloadedLogs) {
                if (log.startsWith(this.name)) {
                    this.log(`Log file is downloaded before, skipping the download: ${path.join(downloadPath, log)}`.yellow)
                    return;
                }
            }
        }

        if (files.length == 0) {
            this.log(`No files found!`.red);
            return;
        }

        const filesString = files.map(file => file.absolute).join('|');
        let zipResponse = await this.zipOnHAC(filesString);

        if (zipResponse == null || zipResponse.status !== 200) {
            this.log(`Error zipping ${files.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}!`.red)
            return;
        }

        const size = zipResponse.data.size;
        this.log(`Zipped size is [${size}] of files: ${files.map((file, index) => index % 2 == 0 ? file.name.white : file.name.gray)}`.green);
        this.log(`Starting download...`.yellow);
        const fileStream = await this.instance({
            method: "GET",
            url: this.downloadUrl,
            responseType: 'stream'
        });
        const outputName = `./downloads/${this.name}-${fileName}.zip`;
        if (fs.existsSync(outputName)) {
            this.log(`File [${outputName}] exists so deleting it...`.yellow);
            fs.unlinkSync(outputName);
        }
        const writeStream = fs.createWriteStream(outputName);
        const progressBar = new ProgressBar(`[${this.name}]`.underline.blue + ` [:bar] :percent :etas`.white, {
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: size*1024
        });
      
        fileStream.data.on('data', (chunk) => {
          progressBar.tick(chunk.length);
        });
      
        await new Promise((resolve, reject) => {
          fileStream.data.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      
        progressBar.terminate();
        this.log(`Download of [${outputName}] completed!`.green);  

        const extractPath = this.unzip(outputName, fileName);

        this.extractFromTomcatPath(extractPath, files, fileName);

        this.log(`All operations completed for [${outputName}]!`.green);
    }

    async zipOnHAC(filesString) {
        this.log(`Zipping files...`.yellow);
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
        }
        return zipResponse;
    }

    unzip(outputName, fileName) {
        this.log(`Unzipping [${outputName}]...`.green);
        const extractPath = `./downloads/${this.name}_${fileName}`;
        if (fs.existsSync(extractPath)) {
            this.log(`Extract path directory [${extractPath}] exists so deleting it...`.yellow);
            fs.rmSync(extractPath, { recursive: true });
        }
        execSync(`unzip -o ${outputName} -d ${extractPath}`);
        fs.unlinkSync(outputName);
        return extractPath;
    }

    extractFromTomcatPath(extractPath, files, fileName) {
        const tomcatPath = `${extractPath}/logs/tomcat`;
        if (files.length == 1 && fs.existsSync(tomcatPath)) {
            this.log(`Tomcat log directory found, moving all logs out..`.yellow);

            const folderPath = this.getDownloadPath(fileName);

            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath);
            }

            const files = fs.readdirSync(tomcatPath);
            files.forEach(async (file) => {
                const parsedPath = path.parse(file);
                const name = parsedPath.name;
                const ext = parsedPath.ext;
                const sourcePath = path.join(tomcatPath, file);
                const targetPath = path.join(folderPath, `${this.name}_${fileName}_${name}${ext}`);
                if (fs.existsSync(targetPath)) {
                    this.log(`Log file [${targetPath}] already exists, removing it!`.yellow);
                    fs.rmSync(targetPath);
                }
                fs.renameSync(sourcePath, targetPath);
                fs.rmSync(extractPath, { recursive: true });
                this.log(`Log file moved out, directory deleted!`.green);
            });
        }
    }

    getDownloadPath(fileName) {
        const folderName = fileName.replace("-", "_").replace(".", "_");
        return path.join("./downloads", folderName);
    }
}

module.exports = HACClient