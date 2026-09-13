/**
 * Returns the query parameters as a key/value object. 
 * Example: If the query parameters are
 *
 *    abc=123&def=456&name=gman
 *
 * Then `getQuery()` will return an object like
 *
 *    {
 *      abc: '123',
 *      def: '456',
 *      name: 'gman',
 *    }
 * 
 * source: https://threejs.org/manual/#en/debugging-javascript 
 */

/* @__NO_SIDE_EFFECTS__ */
export function getQuery() {
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

/* @__NO_SIDE_EFFECTS__ */
export function isEmpty(obj: Object): boolean {
  return Object.keys(obj).length === 0;
}

