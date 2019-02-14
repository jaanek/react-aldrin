import 'isomorphic-fetch';

import path from 'path';

import React from 'react';
import express from 'express';

import parse5 from 'parse5';
import parse5DefAdapter from 'parse5/lib/tree-adapters/default';

import { renderWithTreeAdapter } from '../../src/renderer';
import { App } from './src';

const app = express();
const port = 3000;

const createHtml = markup => `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
</head>

<body>
  <div id="react-app">${markup}</div>
  <script src="main.js"></script>
</body>

</html>
`;

app.use(express.static(path.join(__dirname, 'dist')));

const colors = { 1: 'Red', 2: 'Green', 3: 'Blue' };

app.get('/api/colors/:colorId', (req, res) => {
    res.send(colors[req.params.colorId]);
});

app.get('/', async (req, res) => {
    // const { markup, markupWithCacheData, cache } = await renderToString(<App />);
    const {node, cache} = await renderWithTreeAdapter(parse5DefAdapter, <App />);
    console.log(`Example node: `, node);
    const markup =  parse5.serialize(node);
    const cacheData = cache.serialize();
    const innerHTML = `window.__REACT_CACHE_DATA__ = ${cacheData};`;
    const markupWithCacheData = `${markup}<script id="react_cache_data_container">${innerHTML}</script>`;
    res.send(createHtml(markupWithCacheData));
});

app.listen(port, () =>
    console.log(`Basic example app listening on port ${port}!`)
);
