import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.mjs';


function extractKeys(object, maxDepth = 1) {
    const fields = new Set();

    if (maxDepth <= 0) {
        return fields;
    }

    for (const key in object) {
        fields.add(key);
        const value = object[key]
        if (value && typeof value == 'object') {
            for (const subKey of extractKeys(value, maxDepth - 1)) {
                fields.add(`${key}.${subKey}`);
            }
        }
    }
    return fields;
}


/**
 @param {import('./graph.js').Graph} graph
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
        // findAllMatches: false,
        // minMatchCharLength: 1,
        // location: 0,
        // threshold: 0.6,
        // distance: 100,
        useExtendedSearch: true,
        // ignoreLocation: false,
        // ignoreFieldNorm: false,
        // fieldNormWeight: 1,
        keys: [...allKeys],
    };

    const fuse = new Fuse(graph.getNodes(), fuseOptions);

    const searchResults = fuse.search(expression);

    console.log("search results", searchResults);

    const matchedNodeIds = new Set();

    for (const searchResultItem of searchResults) {
        matchedNodeIds.add(searchResultItem.item.id);
    }

    return {
        nodeIds: matchedNodeIds,
    }
}
