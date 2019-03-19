/**
 * Copyright (c) 2018-present, Fredrik Höglund
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Some of the code in this file is copied or adapted from the React project,
 * used under the license below:
 *
 * Copyright (c) 2013-2018, Facebook, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:

 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import './reactMonkeyPatch';

// For now the scheduler uses requestAnimationFrame,
// so we need to polyfill it
import 'raf/polyfill';
import React from 'react';
import Reconciler from 'react-reconciler';
import * as ReactScheduler from 'scheduler';
import emptyObject from 'fbjs/lib/emptyObject';

import omittedCloseTags from './react-dom/src/shared/omittedCloseTags';
import isCustomComponent from './react-dom/src/shared/isCustomComponent';
import escapeTextForBrowser from './react-dom/src/server/escapeTextForBrowser';
import {
    createMarkupForCustomAttribute,
    createMarkupForProperty
} from './react-dom/src/server/DOMMarkupOperations';
import createMarkupForStyles from './reactUtils/createMarkupForStyles';

import DispatcherModifier from './DispatcherModifier';
import { PrimaryCacheContext, createCache } from '../react';

export const ROOT_TYPE = Symbol('ROOT_TYPE');
export const ROOT_STATIC_TYPE = Symbol('ROOT_STATIC_TYPE');
export const RAW_TEXT_TYPE = Symbol('RAW_TEXT_TYPE');

function isEventListener(propName) {
    return propName.slice(0, 2).toLowerCase() === 'on';
}

function renderChildren(adapter, parent, children, staticMarkup, selectedValue) {
    for (let i = 0, l = children.length; i < l; i += 1) {
        const previousWasText = i > 0 && children[i - 1].type === RAW_TEXT_TYPE;
        children[i].render(
            adapter,
            parent,
            staticMarkup,
            previousWasText,
            undefined,
            selectedValue
        );
    }
}

const RESERVED_PROPS = {
    children: null,
    dangerouslySetInnerHTML: null,
    suppressContentEditableWarning: null,
    suppressHydrationWarning: null
};

export class SSRTreeNode {
    constructor(type, text) {
        this.type = type;
        this.text = text;
        this.attributes = {};
    }
    children = [];
    appendChild(child) {
        this.children.push(child);
    }
    insertBefore(child, beforeChild) {
        this.children.splice(this.children.indexOf(beforeChild, 0, child));
    }
    removeChild(child) {
        this.children = this.children.filter(c => c !== child);
    }
    setText(text) {
        this.text = text;
    }
    setAttribute(name, value) {
        this.attributes[name] = value;
    }
    renderAttribute(name, value) {
        return {name: name, value: value};
    }
    renderAttributes(attributes) {
        // const ret = [];
        const attrs = [];
        for (const key in attributes) {
            if (!attributes.hasOwnProperty(key)) {
                continue;
            }
            let value = attributes[key];
            console.log(`SSRRenderer renderAttributes! Key: ${key}, value: `, value);
            if (value == null) {
                continue;
            }
            if (key === 'style') {
                value = createMarkupForStyles(value);
            }

            // TODO! Currently supports only string attribute values
            if (typeof value === 'string') {
                attrs.push({name: key, value: value});
            }

            // let markup = null;
            // if (isCustomComponent(this.type.toLowerCase(), attributes)) {
            //     if (!RESERVED_PROPS.hasOwnProperty(key)) {
            //         markup = createMarkupForCustomAttribute(key, value);
            //     }
            // } else {
            //     markup = createMarkupForProperty(key, value);
            // }
            // if (markup) {
            //     ret += ' ' + markup;
            // }
        }
        return attrs;
    }
    render(adapter, parent, staticMarkup, previousWasText, isRoot, selectedValue) {
        console.log(`render! Adapter: ${adapter}: `, this.type);
        let finalAttributes = this.attributes;
        let selectSelectedValue;
        let childrenMarkup;
        const rawInnerHtml =
            this.attributes.dangerouslySetInnerHTML &&
            this.attributes.dangerouslySetInnerHTML.__html;

        // check roots
        if (this.type === ROOT_STATIC_TYPE) {
            return renderChildren(adapter, parent, this.children, staticMarkup);
        }
        if (this.type === ROOT_TYPE) {
            return this.children.forEach(c => c.render(adapter, parent, staticMarkup, undefined, true));
        }

        // check texts
        if (this.type === RAW_TEXT_TYPE) {
            let text;
            if (!staticMarkup && previousWasText) {
                text = '<!-- -->' + escapeTextForBrowser(this.text);
            } else {
                text = escapeTextForBrowser(this.text);
            }
            return adapter.insertText(parent, text);
        }

        const element = adapter.createElement(this.type, undefined, []);

        if (this.type === 'input') {
            if (finalAttributes.defaultValue || finalAttributes.defaultChecked) {
                finalAttributes = Object.assign({}, finalAttributes, {
                    value:
                        finalAttributes.value != null
                            ? finalAttributes.value
                            : finalAttributes.defaultValue,
                    defaultValue: undefined,
                    checked:
                        finalAttributes.Checked != null
                            ? finalAttributes.Checked
                            : finalAttributes.defaultChecked,
                    defaultChecked: undefined
                });
            }
        } else if (this.type === 'select') {
            if (finalAttributes.value || finalAttributes.defaultValue) {
                selectSelectedValue = finalAttributes.value || finalAttributes.defaultValue;
                finalAttributes = Object.assign({}, finalAttributes, {
                    value: undefined,
                    defaultValue: undefined
                });
            }
        } else if (this.type === 'textarea') {
            if (finalAttributes.value || finalAttributes.defaultValue) {
                this.appendChild(
                    new SSRTreeNode(
                        RAW_TEXT_TYPE,
                        finalAttributes.value || finalAttributes.defaultValue
                    )
                );
                finalAttributes = Object.assign({}, finalAttributes, {
                    value: undefined,
                    defaultValue: undefined
                });
            }
        } else if (this.type === 'option') {
            renderChildren(
                adapter,
                parent,
                this.children,
                staticMarkup,
                selectSelectedValue
            );
            let selected = null;
            if (selectedValue != null) {
                let value = finalAttributes.value != null ? finalAttributes.value : undefined;
                if (Array.isArray(selectedValue)) {
                    for (let i = 0; i < selectedValue.length; i++) {
                        if (selectedValue[i] === value) {
                            selected = true;
                            break;
                        }
                    }
                } else {
                    selected = selectedValue === value;
                }
                finalAttributes = Object.assign({}, { selected }, finalAttributes);
            }
        }

        // apply attributes
        adapter.adoptAttributes(element, this.renderAttributes(finalAttributes));
        if (isRoot) {
            adapter.adoptAttributes(element, [
                {name: 'data-reactroot', value: ''},
            ]);
        }

        // append current element to the parent
        adapter.appendChild(parent, element);

        if (rawInnerHtml) {
            return adapter.insertText(element, rawInnerHtml);
        }

        // render children into current element
        renderChildren(
            adapter,
            element,
            this.children,
            staticMarkup,
            selectSelectedValue
        );

        // const selfClose = !this.children.length && omittedCloseTags[this.type];
        // const startTag = `<${this.type}${this.renderAttributes(
        //     finalAttributes
        // )}${isRoot ? ' data-reactroot=""' : ''}${selfClose ? '/>' : '>'}`;
        // childrenMarkup =
        //     rawInnerHtml ||
        //     childrenMarkup ||
        //     renderChildren(
        //         this.children,
        //         staticMarkup,
        //         selectSelectedValue
        //     );
        // const endTag = selfClose ? '' : `</${this.type}>`;
        // return startTag + childrenMarkup + endTag;
    }
}

function createHostConfig() {
    return {
        getRootHostContext(rootInstance) {
            return emptyObject;
        },

        getChildHostContext(parentHostContext, type) {
            return emptyObject;
        },

        // Useful only for testing
        getPublicInstance(inst) {
            return inst;
        },

        // Create the DOMElement, but attributes are set in `finalizeInitialChildren`
        createInstance(
            type,
            props,
            rootContainerInstance,
            hostContext,
            internalInstanceHandle
        ) {
            return new SSRTreeNode(type);
        },

        // appendChild for direct children
        appendInitialChild(parentInstance, child) {
            parentInstance.appendChild(child);
        },

        // Actually set the attributes and text content to the domElement and check if
        // it needs focus, which will be eventually set in `commitMount`
        finalizeInitialChildren(element, type, props) {
            Object.keys(props).forEach(propName => {
                const propValue = props[propName];

                if (propName === 'children') {
                    if (
                        typeof propValue === 'string' ||
                            typeof propValue === 'number'
                    ) {
                        element.appendChild(
                            new SSRTreeNode(RAW_TEXT_TYPE, propValue)
                        );
                    }
                } else if (propName === 'className') {
                    element.setAttribute('class', propValue);
                } else if (!isEventListener(propName)) {
                    element.setAttribute(propName, propValue);
                }
            });
            return false;
        },

        // Calculate the updatePayload
        prepareUpdate(domElement, type, oldProps, newProps) {},

        shouldSetTextContent(type, props) {
            return (
                type === 'textarea' ||
                    typeof props.children === 'string' ||
                    typeof props.children === 'number'
            );
        },
        shouldDeprioritizeSubtree(type, props) {},
        createTextInstance(
            text,
            rootContainerInstance,
            hostContext,
            internalInstanceHandle
        ) {
            return new SSRTreeNode(RAW_TEXT_TYPE, text);
        },
        scheduleDeferredCallback: ReactScheduler.unstable_scheduleCallback,
        cancelDeferredCallback: ReactScheduler.unstable_cancelCallback,
        shouldYield: ReactScheduler.unstable_shouldYield,

        scheduleTimeout: setTimeout,
        cancelTimeout: clearTimeout,

        setTimeout: setTimeout,
        clearTimeout: clearTimeout,

        noTimeout: -1,

        // Commit hooks, useful mainly for react-dom syntethic events
        prepareForCommit() {},
        resetAfterCommit() {},

        now: ReactScheduler.unstable_now,
        isPrimaryRenderer: true,
        //useSyncScheduling: true,

        supportsMutation: true,
        commitUpdate(
            domElement,
            updatePayload,
            type,
            oldProps,
            newProps,
            internalInstanceHandle
        ) {},
        commitMount(domElement, type, newProps, internalInstanceHandle) {},
        commitTextUpdate(textInstance, oldText, newText) {
            textInstance.setText(newText);
        },
        resetTextContent(textInstance) {
            textInstance.setText('');
        },
        appendChild(parentInstance, child) {
            parentInstance.appendChild(child);
        },

        // appendChild to root container
        appendChildToContainer(parentInstance, child) {
            parentInstance.appendChild(child);
        },
        insertBefore(parentInstance, child, beforeChild) {
            parentInstance.insertBefore(child, beforeChild);
        },
        insertInContainerBefore(parentInstance, child, beforeChild) {
            parentInstance.insertBefore(child, beforeChild);
        },
        removeChild(parentInstance, child) {
            parentInstance.removeChild(child);
        },
        removeChildFromContainer(parentInstance, child) {
            parentInstance.removeChild(child);
        },

        // These are todo and not well understood on the server
        hideInstance() {},
        hideTextInstance() {},
        unhideInstance() {},
        unhideTextInstance() {},

        //
        schedulePassiveEffects: ReactScheduler.unstable_scheduleCallback,
        cancelPassiveEffects: ReactScheduler.unstable_cancelCallback,
    };
}

class ReactRoot {
    constructor(adapter, staticMarkup) {
        this._adapter = adapter;
        const rootType = staticMarkup ? ROOT_STATIC_TYPE : ROOT_TYPE;
        const ssrTreeRootNode = new SSRTreeNode(rootType);
        this._reconciler = Reconciler(new createHostConfig());
        this._internalTreeRoot = ssrTreeRootNode;
        this._internalRoot = this._reconciler.createContainer(ssrTreeRootNode, true);
        this._staticMarkup = staticMarkup;
    }

    /**
     * @param children {ReactNodeList}
     */
    render(children) {
        const root = this._internalRoot;
        const work = new ReactWork(this._adapter, this._internalTreeRoot, {
            staticMarkup: this._staticMarkup
        });
        this._reconciler.updateContainer(children, root, null, work._onCommit);
        return work;
    };
    unmount() {
        const root = this._internalRoot;
        const work = new ReactWork(this._adapter, this._internalTreeRoot);
        callback = callback === undefined ? null : callback;
        this._reconciler.updateContainer(null, root, null, work._onCommit);
        return work;
    };
}

class ReactWork {
    constructor(adapter, internalRoot, { staticMarkup = false } = {}) {
        this._callbacks = null;
        this._didCommit = false;
        // TODO: Avoid need to bind by replacing callbacks in the update queue with
        // list of Work objects.
        this._onCommit = this._onCommit.bind(this);
        this._adapter = adapter;
        this._internalRoot = internalRoot;
        this._staticMarkup = staticMarkup;
    }

    then(onCommit) {
        if (this._didCommit) {
            const rootElement = this._adapter.createDocumentFragment();
            this._internalRoot.render(this._adapter, rootElement, this._staticMarkup);
            onCommit(rootElement);
            return;
        }
        let callbacks = this._callbacks;
        if (callbacks === null) {
            callbacks = this._callbacks = [];
        }
        callbacks.push(onCommit);
    };

    _onCommit() {
        if (this._didCommit) {
            return;
        }
        this._didCommit = true;
        const callbacks = this._callbacks;
        if (callbacks === null) {
            return;
        }
        // TODO: Error handling.
        for (let i = 0; i < callbacks.length; i++) {
            const callback = callbacks[i];
            const rootElement = this._adapter.createDocumentFragment();
            this._internalRoot.render(this._adapter, rootElement, this._staticMarkup);
            callback(rootElement);
        }
    };
}

function createRoot(adapter, { staticMarkup = false } = {}) {
    return new ReactRoot(adapter, staticMarkup);
}

export function renderToString(element) {
    return new Promise((resolve, reject) => {
        const root = createRoot();
        const cache = createCache();
        return root
            .render(
                <DispatcherModifier>
                    <PrimaryCacheContext.Provider value={cache}>
                        {element}
                    </PrimaryCacheContext.Provider>
                </DispatcherModifier>
            )
            .then(markup => {
                const cacheData = cache.serialize();
                const innerHTML = `window.__REACT_CACHE_DATA__ = ${cacheData};`;
                const markupWithCacheData = `${markup}<script id="react_cache_data_container">${innerHTML}</script>`;
                resolve({ markup, markupWithCacheData, cache });
            });
    });
}

export function renderToStaticMarkup(element) {
    return new Promise((resolve, reject) => {
        const root = createRoot({ staticMarkup: true });
        const cache = createCache();
        return root
            .render(
                <DispatcherModifier>
                    <PrimaryCacheContext.Provider value={cache}>
                        {element}
                    </PrimaryCacheContext.Provider>
                </DispatcherModifier>
            )
            .then(markup => {
                resolve({ markup, cache });
            });
    });
}

/**
 * @param adapter {TreeAdapter}
 * @param element {ReactElement}
 */
export function renderWithTreeAdapter(adapter, element) {
    return new Promise((resolve, reject) => {
        const root = createRoot(adapter);
        const cache = createCache();
        return root
            .render(
                <DispatcherModifier>
                    <PrimaryCacheContext.Provider value={cache}>
                        {element}
                    </PrimaryCacheContext.Provider>
                </DispatcherModifier>
            )
            .then(node => {
                // const cacheData = cache.serialize();
                // const innerHTML = `window.__REACT_CACHE_DATA__ = ${cacheData};`;
                // const markupWithCacheData = `${markup}<script id="react_cache_data_container">${innerHTML}</script>`;
                resolve({ node, cache });
            });
    });
}

export default {
    renderToString,
    renderToStaticMarkup,
    renderWithTreeAdapter
};
