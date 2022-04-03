// ==UserScript==
// @name         ScoreSaberBot (Based on PlaceNL Bot)
// @namespace    https://github.com/PlaceNL/Bot
// @version      8
// @description  Bot to defend ScoreSaber
// @author       NoahvdAa with modifications by TheWhiteShadow
// @match        https://www.reddit.com/r/place/*
// @match        https://new.reddit.com/r/place/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=reddit.com
// @require      https://cdn.jsdelivr.net/npm/toastify-js
// @resource     TOASTIFY_CSS https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css
// @updateURL    https://github.com/TWS-C/Bot/raw/master/ssDefender.user.js
// @downloadURL  https://github.com/TWS-C/Bot/raw/master/ssDefender.user.js
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// ==/UserScript==

let hasOrders   = false;
let placeOrders = [];
let accessToken;
let canvas      = document.createElement('canvas');

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
    {hex: '#BE0039', id: 1, name: 'dark red'},
    {hex: '#FF4500', id: 2, name: 'red'},
    {hex: '#FFA800', id: 3, name: 'orange'},
    {hex: '#FFD635', id: 4, name: 'yellow'},
    {hex: '#00A368', id: 6, name: 'dark green'},
    {hex: '#00CC78', id: 7, name: 'green'},
    {hex: '#7EED56', id: 8, name: 'light green'},
    {hex: '#00756F', id: 9, name: 'dark teal'},
    {hex: '#009EAA', id: 10, name: 'teal'},
    {hex: '#2450A4', id: 12, name: 'dark blue'},
    {hex: '#3690EA', id: 13, name: 'blue'},
    {hex: '#51E9F4', id: 14, name: 'light blue'},
    {hex: '#493AC1', id: 15, name: 'indigo'},
    {hex: '#6A5CFF', id: 16, name: 'periwinkle'},
    {hex: '#811E9F', id: 18, name: 'dark purple'},
    {hex: '#B44AC0', id: 19, name: 'purple'},
    {hex: '#FF3881', id: 22, name: 'pink'},
    {hex: '#FF99AA', id: 23, name: 'light pink'},
    {hex: '#6D482F', id: 24, name: 'dark brown'},
    {hex: '#9C6926', id: 25, name: 'brown'},
    {hex: '#000000', id: 27, name: 'black'},
    {hex: '#898D90', id: 29, name: 'gray'},
    {hex: '#D4D7D9', id: 30, name: 'light gray'},
    {hex: '#FFFFFF', id: 31, name: 'white'},
];

(async function ()
{
    GM_addStyle(GM_getResourceText('TOASTIFY_CSS'));
    canvas.width  = 1000;
    canvas.height = 1000;
    canvas        = document.body.appendChild(canvas);

    Toastify({
        text:     'Retrieving access token...',
        duration: 10000,
    }).showToast();
    accessToken = await getAccessToken();
    Toastify({
        text:     'Access token retrieved!',
        duration: 10000,
    }).showToast();

    setInterval(updateOrders, 5 * 60 * 1000); // Update orders every 5 minutes.
    await updateOrders();
    await attemptPlace();
})();

async function attemptPlace()
{
    if (!hasOrders)
    {
        setTimeout(attemptPlace, 2000); // try again in 2sec.
        return;
    }
    let wrongPixels;
    try
    {
        wrongPixels = await getWrongPixels();
    }
    catch (e)
    {
        console.warn('Failed to get array of wrong pixels: ', e);
        Toastify({
            text:     'Failed to get array of wrong pixels. Retrying in 15 sec...',
            duration: 10000,
        }).showToast();
        setTimeout(attemptPlace, 15000);
        return;
    }

    if (wrongPixels.length > 0)
    {
        // Only has a 1/4 base chance of placing pixel to avoid multiple bots trying to place the same pixel and wasting time because of it.
        // Chance of placing pixel is increased when multiple pixels are wrong.
        if (Math.random() >= 1 / (3 + wrongPixels.length / wrongPixels.length))
        {
            console.log(`Found ${wrongPixels.length} wrong pixel${wrongPixels.length > 1 ? 's' : ''} but skipping placement to avoid collisions.`);
            Toastify({
                text:     `Found ${wrongPixels.length} wrong pixel${wrongPixels.length > 1 ? 's' : ''} but skipping placement to avoid collisions.`,
                duration: 10000,
            }).showToast();
            setTimeout(attemptPlace, 5000);
            return;
        }
        // Pick a random wrong pixel to replace to further avoid bot collisions.
        let wrongPixel = wrongPixels[Math.floor(Math.random() * wrongPixels.length)];
        let x     = wrongPixel.x;
        let y     = wrongPixel.y;
        let color = wrongPixel.correct;

        console.log(`Trying to place ${color.name} pixel on (${x},${y})...`);
        Toastify({
            text:     `Trying to place ${color.name} pixel on ${x}, ${y}...`,
            duration: 10000,
        }).showToast();
        let data = await (await place(x, y, color.id)).json();
        try
        {
            if (data.errors)
            {
                let nextPixelDate = new Date(data.errors[0].extensions.nextAvailablePixelTs + 3000);
                let delay         = nextPixelDate.getTime() - Date.now();
                Toastify({
                    text:     `Tried placing pixel too soon! Next pixel can be placed at ${nextPixelDate.toLocaleTimeString()}.`,
                    duration: delay
                }).showToast();
                setTimeout(attemptPlace, delay);
            }
            else
            {
                let nextPixelDate = new Date(data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000);
                let delay         = nextPixelDate.getTime() - Date.now();
                Toastify({
                    text:     `Successfully placed ${color.name} pixel on ${x}, ${y}. Next pixel can be placed at ${nextPixelDate.toLocaleTimeString()}.`,
                    duration: delay
                }).showToast();
                setTimeout(attemptPlace, delay);
            }
        }
        catch (e)
        {
            console.warn('Error in response analysis', e);
            Toastify({
                text:     `Error in response analysis: ${e}.`,
                duration: 10000
            }).showToast();
            setTimeout(attemptPlace, 10000);
        }

        return;
    }

    Toastify({
        text:     'All the pixels are already in the right place!',
        duration: 10000,
    }).showToast();
    setTimeout(attemptPlace, 5000);
}

/**
 * @return {Promise<{x: number, y: number, wrong: Color, correct: Color}[]>}
 */
async function getWrongPixels()
{
    let wrongPixels = [];
    console.debug('Fetching current canvas.');
    let canvasUrl = await getCurrentImageUrl();
    let ctx       = await getCanvasFromUrl(canvasUrl);
    console.debug('Fetched current canvas from ' + canvasUrl);

    for (const order of placeOrders)
    {
        let x            = order[0];
        let y            = order[1];
        let color        = getColor(order[2]);
        let currentRgba  = ctx.getImageData(x, y, 1, 1).data;
        let currentColor = getClosestColor(currentRgba[0], currentRgba[1], currentRgba[2]);

        if (typeof currentColor === 'undefined')
        {
            let hex = rgbToHex(currentRgba[0], currentRgba[1], currentRgba[2]);
            console.warn(`Found wrong pixel at ${x} ${y} with undefined color (${hex}) but needs to be ${color.name}.`);
        }
        else if (currentColor.id === color.id)
        {
            continue;
        }
        else
        {
            console.debug(`Found wrong pixel at (${x},${y}) with ${currentColor.name} color but needs to be ${color.name}.`);
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
    console.debug('Loading new placement orders.');
    fetch('https://cdn.scoresaber.com/downloads/placeOrders.json')
        .then(async (response) =>
        {
            if (!response.ok)
            {
                return console.warn('Could not load new placement orders! (non-ok status code)');
            }
            let data = await response.json();

            if (JSON.stringify(data) !== JSON.stringify(placeOrders))
            {
                console.debug(`Loaded new placement orders. Total pixel count: ${data.length}.`);
                Toastify({
                    text:     `Loaded new placement orders. Total pixel count: ${data.length}.`,
                    duration: 10000,
                }).showToast();
            }

            placeOrders = data;
            hasOrders   = true;
        })
        .catch((e) => console.warn('Could not load new placement orders!', e));
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} colorId
 * @returns {Promise<Response>}
 */
function place(x, y, colorId)
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
        window.location.reload();
    }
}

/**
 * @returns {Promise<string>}
 */
async function getAccessToken()
{
    const usingOldReddit = window.location.href.includes('new.reddit.com');
    const url            = usingOldReddit ? 'https://new.reddit.com/r/place/' : 'https://www.reddit.com/r/place/';
    const response       = await fetch(url);
    const responseText   = await response.text();
    return responseText.split('\"accessToken\":\"')[1].split('"')[0];
}

/**
 * @returns {Promise<string>}
 */
async function getCurrentImageUrl()
{
    return new Promise((resolve, reject) =>
    {
        let ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws');

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
                                'tag':       '0'
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
 * @param {string} url
 * @returns {Promise<CanvasRenderingContext2D>}
 */
function getCanvasFromUrl(url)
{
    return new Promise((resolve, reject) =>
    {
        GM.xmlHttpRequest({
            'method':       'GET',
            'url':          url,
            'responseType': 'arraybuffer',
            onerror:        reject,
            onload:         function (response)
                            {
                                let bytes  = new Uint8Array(response.response);
                                let binary = [].map.call(bytes, byte => String.fromCharCode(byte)).join('');
                                let mediaType;
                                response.responseHeaders.split('\r\n').findIndex(header =>
                                {
                                    if (header.indexOf('content-type: ') === 0)
                                    {
                                        mediaType = header.substring('content-type: '.length);
                                        return true;
                                    }
                                });
                                let base64 = [
                                    'data:',
                                    mediaType ? `${mediaType};` : '',
                                    'base64,',
                                    btoa(binary)
                                ].join('');

                                let ctx     = canvas.getContext('2d');
                                let img     = new Image();
                                img.onerror = reject;
                                img.onload  = () =>
                                {
                                    ctx.drawImage(img, 0, 0);
                                    resolve(ctx);
                                };
                                img.src     = base64;
                            }
        });
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
