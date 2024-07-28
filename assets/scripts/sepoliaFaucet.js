const webSocket = require('ws');
const url = process.argv[2];
const puppeteer = require('puppeteer-extra');
const lanPlugin = require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
const userAgentPlugin = require('puppeteer-extra-plugin-stealth/evasions/user-agent-override');
const webglPlugin = require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor');
const path = require('path');
const ChromeLauncher = require('chrome-launcher');


console.log('收到的URL参数:', url);

let ws = new webSocket(url);
let webSocketReady = false;
let taskData = null;

// 心跳包定时发送
function sendHeartBeat() {
    setInterval(() => {
        if (ws.readyState === webSocket.OPEN) {
            const heartBeatMessage = JSON.stringify({
                type: 'heart_beat'
            });
            ws.send(heartBeatMessage);
        }
    }, 5000); // 每 5 秒发送一次心跳包
}

function sendRequestTaskData() {
    if (ws.readyState === webSocket.OPEN) {
        const requestTaskDataMessage = JSON.stringify({
            type: 'request_task_data',
            data: ''
        });
        ws.send(requestTaskDataMessage);
    }
}

function sendTaskLog(log) {
    if (ws.readyState === webSocket.OPEN) {
        const taskLogMessage = JSON.stringify({
            type: 'task_log',
            message: log
        });
        ws.send(taskLogMessage);
    }
}

function sendTaskCompleted(taskName,success,message) {
    if (ws.readyState === webSocket.OPEN) {
        const taskCompletedMessage = JSON.stringify({
            type: 'task_completed',
            taskName,
            success,
            message
        });
        ws.send(taskCompletedMessage);
    }
}
function sendTerminateProcess() {
    if (ws.readyState === webSocket.OPEN) {
        const terminateProcessMessage = JSON.stringify({
            type: 'terminate_process'
        });
        ws.send(terminateProcessMessage);
    }
}
function exit() {
    ws.close();
    process.exit(0);
}

ws.on('open', () => {
    webSocketReady = true;
    sendHeartBeat();
});

ws.on('message', (message) => {
    let data = JSON.parse(message);
    switch (data.type) {
        case 'heart_beat':
            break;
        case 'request_task_data':
            console.log('收到任务数据:', data);
            taskData = JSON.parse(data.data);
            break;
        case 'terminate_process':
            sendTerminateProcess();
            exit();
        default:
            break;
    }
});

ws.on('error', (error) => {
    console.error('WebSocket连接发生错误:', error);
    // 关闭连接并退出
    ws.close();
    process.exit(1);
});

// 定时检查连接状态，如果连接断开则重连
setInterval(() => {
    if (ws.readyState === webSocket.CLOSED) {
        console.log('WebSocket连接断开，尝试重新连接...');
        ws = new webSocket(url);
    }
}, 5000); // 每 5 秒检查一次连接状态

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openWallet(browser) {
    const page = await browser.newPage();
    await page.goto('chrome-extension://kkkcafaonfieeaemfckipjojojhbbnej/home.html#unlock')
    await sleep(5000);
    try {
        await page.waitForSelector('#password');
        await page.type('#password', 'web3ToolBox',{delay:50});
        
        await sleep(2000);
        const element3 = await page.waitForSelector('[data-testid="unlock-submit"]');
        await element3.click();
        await sleep(5000);
        const closeButton = await page.waitForSelector('[data-testid="popover-close"]',{timeout:2000});
        await closeButton.click();
    }catch(error){
        console.log('error:',error);
    }
}

async function autoFaucet(browser){
    const page = await browser.newPage();
    await page.bringToFront();
    await page.goto('https://faucet.quicknode.com/ethereum/sepolia',{timeout:200000});

    //click connect wallet
    const ele = await page.waitForSelector('.my-8.text-center');
    await ele.click();
    
    //lisen for metamask
    browser.on('targetcreated', async (target) => {
        const page = await target.page();
        if (page && page.url().includes('chrome-extension://kkkcafaonfieeaemfckipjojojhbbnej'))
        {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const next = await page.waitForSelector('[data-testid="page-container-footer-next"]',{timeout:5000});
            console.log('next:',next.innerText);
            await next.click();
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const next2 = await page.waitForSelector('[data-testid="page-container-footer-next"]',{timeout:5000});
            await next2.click();

        }
    });

    await sleep(5000);
    //click metamask
    const ele2 = await page.waitForSelector('.btn.orange.w-full.my-2');
    await ele2.click();
    await sleep(6000);
    const selectEle = await page.waitForSelector('#network');
    await selectEle.click();
    await sleep(2000);
    await page.select('#network','sepolia');
    await sleep(500);
    await selectEle.click();
    await sleep(3000);
    await page.mouse.wheel({ deltaY: 100 });
    

    
    await sleep(3000);
    const continueB = await page.waitForSelector('.btn.gap-2.blue');
    

    //check continueB clickable
    await page.waitForFunction(
        'document.querySelector(".btn.gap-2.blue").getAttribute("disabled") === null'
    );
    await continueB.click();
    
    await sleep(3000);
    const sendEth = await page.waitForSelector('[value="step-two-skip"]');
    //check sendEth visible
    if (await sendEth.isVisible()) {
        await page.mouse.wheel({ deltaY: 100 });
        await sleep(3000);
        //check sendEth clickable
        const boundingBox = await sendEth.boundingBox();
        if (boundingBox) {
            await page.waitForFunction(
                'document.querySelector("[type=submit]").getAttribute("disabled") === null'
            );
            await sendEth.click();
        } else {
            console.error('元素被遮挡');
        }
    } else {
        console.error('元素不可见');
    }
    //check success
    const successSign = await page.waitForSelector('.text-lg.text-white.elipsis',{timeout:20000});
    //check successSign text
    if (await successSign.evaluate(node => node.innerText) === 'Transaction in Queue') {
        return true;
    }
    return false;
}

// 进行任务逻辑
async function runTask() {
    console.log('任务开始执行');
    const chromePath = ChromeLauncher.Launcher.getInstallations();
    let wallet = taskData;
    console.log(wallet)
    
    if (wallet.language){
        puppeteer.use(lanPlugin({ language: wallet.language.split(',') }));
    }
    if (wallet.userAgent)
    {
        puppeteer.use(userAgentPlugin({ userAgent: wallet.userAgent }));
    }
    if (wallet.webglVendor && wallet.webglRenderer){
        puppeteer.use(webglPlugin({ vendor: wallet.webglVendor, renderer: wallet.webglRenderer }));
    }

    let metamaskEx = path.resolve(__dirname, './metamask-chrome-11.16.2');
    let argArr = [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disabled-setupid-sandbox',
        '--disable-infobars',
        '--disable-extensions-except=' + metamaskEx,
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy',
    ];
    if (wallet.ipInfo && wallet.ipInfo.proxyUrl){
        argArr.push('--proxy-server=' + wallet.ipInfo.proxyUrl);
        argArr.push('--timezone=' + wallet.ipInfo.timeZone);
        argArr.push('--tz=' + wallet.ipInfo.timeZone);
        argArr.push('--geolocation=' + wallet.ipInfo.ll.join(','));
    }     
    console.log('chromePath:', chromePath);
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath[0],
        ignoreDefaultArgs: ['--enable-automation'],
        userDataDir: wallet.chromeUserDataPath,
        defaultViewport: null,
        args: argArr
    }); // Change headless to false for debugging
     // 监听浏览器关闭事件
     browser.on('disconnected', () => {
        console.log('Browser disconnected.');
        // 在这里执行您希望在浏览器关闭时进行的操作
        sendTaskLog('浏览器关闭,退出任务');
        sendTerminateProcess();
        exit();

    });
    await sleep(5000)
    const pages = await browser.pages();
    if(pages.length>1){
        for(let i=1;i<pages.length;i++){
            await pages[i].close();
        }
    }
    await openWallet(browser);
    await sleep(2000);
    let success =false
    try{
        success = await autoFaucet(browser);
    }catch(error){
        console.log('error:',error);
        sendTaskLog(`任务执行出错:${error}`);
    }
    if(success){
        sendTaskLog('领取成功，等待quickNode发送ETH到您的地址');
    }else{  
        sendTaskLog('领取失败，请检查当前地址主网上是否有0.001ETH或者IP是否有效');
    }
    browser.close();
    
    sendTaskCompleted(taskData.taskName,success,{type:'result',message:success});
    exit();

}

(async () => {
    while (true) {
        if (webSocketReady) {
            // console.log('发送任务日志');
            sendRequestTaskData();
            if (taskData) {
                console.log('任务数据:', taskData);
                sendTaskLog('收到任务数据，完成初始化，开始执行任务');
                await runTask();
            }
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 2000);
        });
    }
})();