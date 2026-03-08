const express = require('express');
const app = express();
app.use(express.json());

const PLANET_API = 'https://api.planet.com';

// Calculate centroid from GeoJSON polygon coordinates
function getCentroid(geometry) {
  if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) {
    return { lon: 0, lat: 0 };
  }
  const coords = geometry.coordinates[0];
  let lonSum = 0, latSum = 0;
  for (const [lon, lat] of coords) {
    lonSum += lon;
    latSum += lat;
  }
  const n = coords.length;
  return {
    lon: (lonSum / n).toFixed(4),
    lat: (latSum / n).toFixed(4)
  };
}

// Build Planet Explorer URL for a feature
function buildExplorerUrl(feature) {
  const centroid = getCentroid(feature.geometry);
  const acquired = feature.properties && feature.properties.acquired
    ? feature.properties.acquired.substring(0, 10)
    : '';
  const itemType = feature.properties && feature.properties.item_type
    ? feature.properties.item_type
    : 'PSScene';
  return `https://www.planet.com/explorer/#/center/${centroid.lon},${centroid.lat}/zoom/15/dates/${acquired}/items/${feature.id}:${itemType}`;
}

// Transform API response: replace _links with Planet Explorer URLs
function transformResponse(data) {
  if (!data || !data.features) return data;

  for (const feature of data.features) {
    const explorerUrl = buildExplorerUrl(feature);

    // Replace _links with explorer URL
    feature._links = {
      explorer: explorerUrl
    };

    // Also add explorer_url at top level of feature for easy access
    feature.explorer_url = explorerUrl;
  }

  // Remove pagination _links that also contain auth URLs
  if (data._links) {
    delete data._links;
  }

  return data;
}

// POST /quick-search - proxy to Planet API and transform response
app.post('/quick-search', async (req, res) => {
  try {
    const apiKey = process.env.PLANET_API_KEY;
    const authHeader = apiKey
      ? `api-key ${apiKey}`
      : req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ error: 'No API key configured' });
    }

    const pageSize = req.query._page_size || 3;
    const url = `${PLANET_API}/data/v1/quick-search?_page_size=${pageSize}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `Planet API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    const transformed = transformResponse(data);
    res.json(transformed);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'planet-proxy' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Planet Proxy running on port ${PORT}`);
});
