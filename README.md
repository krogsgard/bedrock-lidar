# Project Bedrock — LIDAR Ground Classification (v0 prototype)

Cloud-native drone lidar ground classification SaaS. Built first for Weygand Land Surveying, designed to be sold to other surveying firms working heavy-vegetation tracts in the Southeast US.

**Status:** v0 scaffold — public LIDAR demo, no real customer data yet.

**Live:** https://lidar.weygand.com

## What this is

A browser-first viewer + scoping landing page for a future SaaS that:
- Takes raw drone LIDAR (`.las`/`.laz`, 10–100 GB tracts)
- Produces ground classification optimized for dense Southeast canopy
- Lets surveyors QC the result in the browser
- Exports LAS 1.4 / GeoTIFF DTM / SHP contours / DWG breaklines

This v0 only ships the marketing site + a working CesiumJS viewer streaming public USGS / OpenTopography COPC data. No upload, no ML, no auth. The point of v0 is to validate the UX and stream-from-R2 architecture before building the real pipeline.

## Stack

- **Astro 5** static site (output:'static') deployed to **Cloudflare Pages**
- **CesiumJS** + COPC streaming for the viewer
- Design system, Layout, fonts, palette borrowed from `team.weygand.com`

## Local dev

```
npm install
npm run dev
```

## Deploy

```
npm run build
wrangler pages deploy dist --project-name=bedrock-lidar
```

Custom domain `lidar.weygand.com` is configured via Cloudflare Pages → Custom domains in the `weygand.com` zone.

## Scope reference

Full product scoping brief: `MayAI/reports/lidar-ground-saas-scope-2026-06-27.md`

## Phased build plan

| Phase | Scope | This repo? |
|---|---|---|
| 0 — Spike (this) | PDAL pipeline + Cesium viewer + landing site, public data only | ✓ |
| 1 — Internal pipeline | Upload UI, D1 job queue, DO GPU CSF, R2 storage | next |
| 2 — QC viewer | Potree + delta edits + export | next |
| 3 — ML model | PTv3-from-Sonata trained on Weygand tracts | next |
| 4 — Customer SaaS | Auth, billing, share links, Trimble Connect push | next |
