/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Intentionally planted image-alt finding. */
import React from 'react';
const meta = { title: 'Recipe/Image' };
export default meta;
export const MissingAlt = { render: () => <main><h1>Storybook recipe</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="32" height="32" /></main> };
export const TextOnly = { render: () => <main><h1>Text story</h1><p>Second story verifies index discovery.</p></main> };
