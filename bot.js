import fetch from 'node-fetch';
import getPixels from "get-pixels";
import WebSocket from 'ws';
import ndarray from "ndarray";
import fs from 'fs';

const args = process.argv.slice(2);

if (args.length !== 1 && !process.env.REDDIT_SESSION)
{
    log("Missing reddit_session cookie.");
    process.exit(1);
}
let redditSessionCookies = (process.env.REDDIT_SESSION || args[0]).split(';');
if (redditSessionCookies.length > 4)
{
    log("Having more than 4 reddit accounts per IP address is not advised!");
}
let hasTokens = false;
let accessTokens;
let defaultAccessToken;

let hasOrders   = false;
/** @type {[x: number, y: number, colorId: number][]} */
let placeOrders = [];

/** @type {PixelMap[]} */
let pixelData = [];

/**
 * @typedef {Object} Color
 * @property {number} id
 * @property {string} name
 * @property {string} hex
 */
/**
 * @type {Color[]}
 */
const COLOR_MAPPINGS = [
    {hex: '#6D001A', id: 0, name: 'burgundy'},
    {hex: '#BE0039', id: 1, name: 'dark red'},
    {hex: '#FF4500', id: 2, name: 'red'},
    {hex: '#FFA800', id: 3, name: 'orange'},
    {hex: '#FFD635', id: 4, name: 'yellow'},
    {hex: '#FFF8B8', id: 5, name: 'pale yellow'},
    {hex: '#00A368', id: 6, name: 'dark green'},
    {hex: '#00CC78', id: 7, name: 'green'},
    {hex: '#7EED56', id: 8, name: 'light green'},
    {hex: '#00756F', id: 9, name: 'dark teal'},
    {hex: '#009EAA', id: 10, name: 'teal'},
    {hex: '#00CCC0', id: 11, name: 'light teal'},
    {hex: '#2450A4', id: 12, name: 'dark blue'},
    {hex: '#3690EA', id: 13, name: 'blue'},
    {hex: '#51E9F4', id: 14, name: 'light blue'},
    {hex: '#493AC1', id: 15, name: 'indigo'},
    {hex: '#6A5CFF', id: 16, name: 'periwinkle'},
    {hex: '#94B3FF', id: 17, name: 'lavender'},
    {hex: '#811E9F', id: 18, name: 'dark purple'},
    {hex: '#B44AC0', id: 19, name: 'purple'},
    {hex: '#E4ABFF', id: 20, name: 'pale purple'},
    {hex: '#DE107F', id: 21, name: 'magenta'},
    {hex: '#FF3881', id: 22, name: 'pink'},
    {hex: '#FF99AA', id: 23, name: 'light pink'},
    {hex: '#6D482F', id: 24, name: 'dark brown'},
    {hex: '#9C6926', id: 25, name: 'brown'},
    {hex: '#FFB470', id: 26, name: 'beige'},
    {hex: '#000000', id: 27, name: 'black'},
    {hex: '#515252', id: 28, name: 'dark gray'},
    {hex: '#898D90', id: 29, name: 'gray'},
    {hex: '#D4D7D9', id: 30, name: 'light gray'},
    {hex: '#FFFFFF', id: 31, name: 'white'},
];

(async function ()
{
    await refreshTokens();
    setInterval(updateOrders, 5 * 60 * 1000); // Update orders every 5 minutes.
    await updateOrders();
    await startPlacement();
})();

async function refreshTokens()
{
    let tokens = [];
    for (const cookie of redditSessionCookies)
    {
        let response = await fetch("https://www.reddit.com/r/place/", {
            'headers': {
                'cookie': `reddit_session=${cookie}`
            }
        });
        tokens.push((await response.text()).split('\"accessToken\":\"')[1].split('"')[0]);
    }

    log(`Refreshed tokens: ${tokens}`)
    accessTokens       = tokens;
    defaultAccessToken = tokens[0]
    hasTokens          = true;

    // Refresh the tokens every 30 minutes.
    setInterval(refreshTokens, 30 * 60 * 1000);
}

function startPlacement()
{
    if (!hasTokens)
    {
        setTimeout(startPlacement, 1000);
        return;
    }

    // Try to stagger pixel placement
    let interval = 300 / accessTokens.length;
    let delay    = 0;
    for (let accessToken of accessTokens)
    {
        setTimeout(() => attemptPlace(accessToken), delay * 1000);
        delay += interval;
    }
}

async function attemptPlace(accessToken = defaultAccessToken)
{
    let retry = () => attemptPlace(accessToken);
    if (!hasOrders)
    {
        setTimeout(retry, 2000);
        return;
    }

    let wrongPixels;
    try
    {
        wrongPixels = await getWrongPixels(accessToken);
    }
    catch (e)
    {
        log(`Failed to get array of wrong pixels: ${e}`);
        setTimeout(retry, 15000);
        return;
    }

    if (wrongPixels.length > 0)
    {
        // Only has a 1/4 base chance of placing pixel to avoid multiple bots trying to place the same pixel and wasting time because of it.
        // Chance of placing pixel is increased when multiple pixels are wrong.
        if (Math.random() >= 1 / (3 + wrongPixels.length / wrongPixels.length))
        {
            log(`Found ${wrongPixels.length} wrong pixel${wrongPixels.length > 1 ? 's' : ''} but skipping placement to avoid collisions.`);
            setTimeout(retry, 5000);
            return;
        }
        // Pick a random wrong pixel to replace to further avoid bot collisions.
        let wrongPixel = wrongPixels[Math.floor(Math.random() * wrongPixels.length)];
        let x     = wrongPixel.x;
        let y     = wrongPixel.y;
        let color = wrongPixel.correct;

        let data = await (await place(x, y, color.id, accessToken)).json();
        try
        {
            if (data.errors)
            {
                let error         = data.errors[0];
                let nextPixelDate = new Date(error.extensions.nextAvailablePixelTs + 3000);
                log(`Tried placing pixel too soon! Next pixel can be placed at ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(retry, nextPixelDate.getTime() - Date.now());
            }
            else
            {
                let nextPixelDate = new Date(data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000);
                log(`Successfully placed ${color.name} pixel on ${x}, ${y}. Next pixel can be placed at ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(retry, nextPixelDate.getTime() - Date.now());
            }
        }
        catch (e)
        {
            log(`Error in response analysis ${e}`);
            setTimeout(retry, 10000);
        }

        return;
    }

    log('All the pixels are already in the right place!')
    setTimeout(retry, 5000);
}

/**
 * @param {string} accessToken
 * @return {Promise<{x: number, y: number, wrong: Color, correct: Color}[]>}
 */
async function getWrongPixels(accessToken)
{
    let wrongPixels = [];

    for (const order of placeOrders)
    {
        let x            = order[0];
        let y            = order[1];
        let color        = getColor(order[2]);
        let currentRgba  = await getRgbaAtLocation(accessToken, x, y);
        let currentColor = getClosestColor(currentRgba[0], currentRgba[1], currentRgba[2]);

        if (typeof currentColor === 'undefined')
        {
            let hex = rgbToHex(currentRgba[0], currentRgba[1], currentRgba[2]);
            log(`Found wrong pixel at ${x} ${y} with undefined color (${hex}) but needs to be ${color.name}.`);
        }
        else if (currentColor.id === color.id)
        {
            continue;
        }
        else
        {
            log(`Found wrong pixel at (${x},${y}) with ${currentColor.name} color but needs to be ${color.name}.`);
        }
        wrongPixels.push({
            'x':       x,
            'y':       y,
            'wrong':   currentColor,
            'correct': color,
        });
    }

    return wrongPixels;
}

function updateOrders()
{
    log('Loading new placement orders.');
    fetch('https://cdn.scoresaber.com/downloads/placeOrders.json')
        .then(async (response) =>
        {
            if (!response.ok)
            {
                return log('Could not load new placement orders! (non-ok status code)');
            }
            let data = await response.json();

            if (JSON.stringify(data) !== JSON.stringify(placeOrders))
            {
                log(`Loaded new placement orders. Total pixel count: ${data.length}.`);
            }

            placeOrders = data;
            hasOrders   = true;
        })
        .catch((e) => log(`Could not load new placement orders! ${e}`));
}

function place(x, y, colorId, accessToken = defaultAccessToken)
{
    try
    {
        return fetch('https://gql-realtime-2.reddit.com/query', {
            method:  'POST',
            body:    JSON.stringify({
                'operationName': 'setPixel',
                'variables':     {
                    'input': {
                        'actionName':       'r/replace:set_pixel',
                        'PixelMessageData': {
                            'coordinate':  {
                                'x': x,
                                'y': y
                            },
                            'colorIndex':  colorId,
                            'canvasIndex': 0
                        }
                    }
                },
                'query':         'mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n'
            }),
            headers: {
                'origin':                    'https://hot-potato.reddit.com',
                'referer':                   'https://hot-potato.reddit.com/',
                'apollographql-client-name': 'mona-lisa',
                'Authorization':             `Bearer ${accessToken}`,
                'Content-Type':              'application/json'
            }
        });
    }
    catch (e)
    {
        log('Failed to place pixel. Refreshing access tokens.');
        // noinspection JSIgnoredPromiseFromCall
        refreshTokens();
    }
}

/**
 * @param {string} accessToken
 * @param {number} id
 * @return {Promise<string>}
 */
async function getCurrentImageUrl(accessToken = defaultAccessToken, id = 0)
{
    return new Promise((resolve, reject) =>
    {
        const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws', {
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
                "Origin":     "https://hot-potato.reddit.com"
            }
        });

        ws.onopen = () =>
        {
            ws.send(JSON.stringify({
                'type':    'connection_init',
                'payload': {
                    'Authorization': `Bearer ${accessToken}`
                }
            }));

            ws.send(JSON.stringify({
                'id':      '1',
                'type':    'start',
                'payload': {
                    'variables':     {
                        'input': {
                            'channel': {
                                'teamOwner': 'AFD2022',
                                'category':  'CANVAS',
                                'tag':       id.toString()
                            }
                        }
                    },
                    'extensions':    {},
                    'operationName': 'replace',
                    'query':         'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}'
                }
            }));
        };

        ws.onmessage = (message) =>
        {
            const {data} = message;
            const parsed = JSON.parse(data);

            // TODO: ew
            if (!parsed.payload || !parsed.payload.data || !parsed.payload.data.subscribe || !parsed.payload.data.subscribe.data)
            {
                return;
            }

            ws.close();
            resolve(parsed.payload.data.subscribe.data.name);
        }


        ws.onerror = reject;
    });
}

/**
 * @typedef {{data: Uint8Array, shape: array, stride: array, offset: number, timestamp: number}} PixelMap
 */
/**
 * @param url
 * @returns {Promise<PixelMap>}
 */
function getMapFromUrl(url)
{
    return new Promise((resolve, reject) =>
    {
        getPixels(url, function (err, pixels)
        {
            if (err)
            {
                reject()
                return
            }
            pixels.timestamp = new Date().getTime();
            resolve(pixels)
        })
    });
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function rgbToHex(r, g, b)
{
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * @param {string} hex
 * @returns {[r: number, g: number, b: number]}
 */
function hexToRgb(hex)
{
    let res = parseInt(hex.substring(1), 16);
    return [(res & parseInt('FF0000', 16)) >> 16, (res & parseInt('FF00', 16)) >> 8, res & parseInt('FF', 16)];
}

/**
 * Sometimes the bot misidentifies a color (for example #000000 can sometimes be read as #010100)
 * so we check if its at least somewhat close and treat it as equal
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {Color|null}
 */
function getClosestColor(r, g, b)
{
    return COLOR_MAPPINGS[
        COLOR_MAPPINGS.findIndex((color) =>
        {
            let rgb = hexToRgb(color.hex);
            return Math.abs(rgb[0] - r) + Math.abs(rgb[1] - g) + Math.abs(rgb[2] - b) <= 5;
        })
        ] || null;
}

/**
 * @param {number} id
 * @returns {Color|null}
 */
function getColor(id)
{
    return COLOR_MAPPINGS[COLOR_MAPPINGS.findIndex((color) => color.id === id)] || null;
}

/**
 * @param {string} accessToken
 * @param {number} x
 * @param {number} y
 * @return {Promise<[r: number, g: number, b: number, a: number]>}
 */
async function getRgbaAtLocation(accessToken, x, y)
{
    let mapId = (x >= 1000 ? 1 : 0) + (y >= 1000 ? 2 : 0);
    if (typeof pixelData[mapId] === 'undefined' || pixelData[mapId].timestamp + 5000 < new Date().getTime())
    {
        try
        {
            log(`Fetching current canvas for section ${mapId}.`);
            let canvasUrl    = await getCurrentImageUrl(accessToken, mapId);
            pixelData[mapId] = await getMapFromUrl(canvasUrl);
            log(`Fetched current canvas from ${canvasUrl}`);
        }
        catch (e)
        {
            log('Failed to fetch current canvas.');
            throw e;
        }
    }
    x = x % 1000;
    y = y % 1000;

    let pos = (x + y * pixelData[mapId].shape[0]) * pixelData[mapId].shape[2];
    return [
        pixelData[mapId].data[pos],
        pixelData[mapId].data[pos + 1],
        pixelData[mapId].data[pos + 2],
        pixelData[mapId].data[pos + 3],
    ]
}

function log(message)
{
    message = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(message);
    fs.appendFile('log.txt', message + '\n', err => { if (err) throw err });
}
