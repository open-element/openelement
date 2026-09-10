/**
 * /404 — custom not-found page for unmatched paths (#923 fallback).
 */
import { defineLitPage } from '@openelement/app/lit';
import { NotFoundPage } from '../components/not-found-page.ts';

export default defineLitPage('not-found-page', NotFoundPage, {
  head: { title: 'app-flow-lit — not found' },
});
