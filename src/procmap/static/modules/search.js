import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.mjs';


function extractKeys(object, maxDepth = 1) {
    const fields = new Set();

    if (maxDepth <= 0) {
        return fields;
    }

    for (const key in object) {
        const value = object[key]
        if (value && typeof value == 'object') {
            for (const subKey of extractKeys(value, maxDepth - 1)) {
                fields.add(`${key}.${subKey}`);
            }
        } else {
            fields.add(key);
        }
    }
    return fields;
}


/**
 @param {import('./graph.js').Graph} graph
 @param {String} expression
*/
export function search(graph, expression) {
    const allKeys = new Set();

    for (const node of graph.getNodes()) {
        const keys = extractKeys(node, 2);
        for (const key of keys) {
            allKeys.add(key);
        }
    }

    console.log('all keys discovered: ', allKeys)

    const fuseOptions = {
        // isCaseSensitive: false,
        includeScore: true,
        // ignoreDiacritics: false,
        // shouldSort: true,
        includeMatches: true,
        findAllMatches: true,
        // minMatchCharLength: 1,
        // location: 0,
        threshold: 0,
        // distance: 100,
        useExtendedSearch: true,
        ignoreLocation: true,
        // ignoreFieldNorm: false,
        // fieldNormWeight: 1,
        keys: [...allKeys],
    };

    const fuse = new Fuse(graph.getNodes(), fuseOptions);

    let matchedNodeIds = null;

    for (const term of expression.split(" ").map(x => x.trim())) {
        if (!term) {
            // skip empty
            continue;
        }

        const searchResults = fuse.search(term);

        console.log(`search results for term ${term}:`, searchResults);

        const termMatchedNodeIds = new Set();

        for (const searchResultItem of searchResults) {
            termMatchedNodeIds.add(searchResultItem.item.id);
        }

        if (matchedNodeIds === null) {
            matchedNodeIds = termMatchedNodeIds;
        } else {
            matchedNodeIds = new Set([...matchedNodeIds].filter(x => termMatchedNodeIds.has(x)));
        }
    }

    return {
        nodeIds: matchedNodeIds,
    }
}
