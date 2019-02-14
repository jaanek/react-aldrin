import React, { Suspense, useContext } from 'react';
import { hydrate, createResource, useReadResource } from '../../../src/react';

const TempContext = React.createContext("TEST");

const colorResource = createResource('colorResource', colorId =>
    fetch(`http://localhost:3000/api/colors/${colorId}`).then(res => res.text())
);

function Color({ colorId }) {
    const colorName = useReadResource(colorResource, colorId);

    return <p>This is a color: {colorName}</p>;
}

function App() {
    const temp = useContext(TempContext);
    return (
        <Suspense fallback={'Loading...'}>
            <Color colorId="1" />
            <Color colorId="2" />
            <Color colorId="3" />
            <div>{temp}</div>
        </Suspense>
    );
}

if (typeof window !== 'undefined') {
    hydrate(<App />, document.getElementById('react-app'));
}

module.exports = {
    App
};
