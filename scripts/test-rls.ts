/**
 * Security regression gate: proves one user cannot read, change or delete another user's data through
 * tables, RPCs or the anon role. Creates two throwaway users, runs the checks, then deletes them.
 *
 *   npm run test:rls     (needs a reachable Supabase project + SUPABASE_SERVICE_ROLE_KEY in .env.local)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

async function createUser(label: string) {
  const email = `rls-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@forgetting-forecast.test`;
  const password = `Rls-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  const client = createClient(url!, anonKey!, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, client };
}

const rows = (r: { data: unknown }) => (Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0);

async function main() {
  const A = await createUser('a');
  const B = await createUser('b');
  const anon: SupabaseClient = createClient(url!, anonKey!, opts);

  try {
    // ---- B creates a full set of rows through its own session ----
    const concept = await B.client.from('concepts').insert({
      user_id: B.id, subject: 'RLS', prompt: 'secret prompt', answer: 'secret answer', difficulty: 3,
    }).select().single();
    if (concept.error) throw new Error(`B concept insert failed: ${concept.error.message}`);
    const conceptId = concept.data.id as string;

    const session = await B.client.from('study_sessions').insert({
      user_id: B.id, started_at: new Date().toISOString(), mode: 'due',
    }).select().single();
    if (session.error) throw new Error(`B session insert failed: ${session.error.message}`);
    const sessionId = session.data.id as string;

    const now = new Date();
    const tx = await B.client.rpc('submit_review_tx', {
      p_attempt: {
        concept_id: conceptId, session_id: sessionId, client_request_id: randomUUID(),
        presented_at: now.toISOString(), answered_at: now.toISOString(),
        elapsed_since_previous_review_hours: null, predicted_recall_probability: 0.5, actual_correctness: true,
        self_reported_confidence: 0.6, response_latency_ms: 4000, model_version: 'm', scheduler_version: 's',
        review_mode: 'due', metadata: null,
      },
      p_state: {
        model_version: 'm', estimated_half_life_hours: 30, repetition_count: 1, successful_recall_count: 1,
        lapse_count: 0, last_reviewed_at: now.toISOString(), next_review_at: new Date(now.getTime() - 1000).toISOString(),
        last_predicted_recall_probability: 0.5,
      },
    });
    if (tx.error) throw new Error(`B submit_review_tx failed: ${tx.error.message}`);
    const attemptId = tx.data.attempt.id as string;

    const forecast = await B.client.from('forecast_log').insert({
      user_id: B.id, concept_id: conceptId, generated_at: now.toISOString(), horizon_hours: 24,
      target_at: new Date(now.getTime() + 86_400_000).toISOString(), predicted_probability: 0.7,
      model_version: 'm', input_snapshot: {}, source_attempt_id: attemptId,
    }).select().single();
    if (forecast.error) throw new Error(`B forecast insert failed: ${forecast.error.message}`);
    const forecastId = forecast.data.id as string;

    const evaluation = await B.client.from('forecast_evaluations').insert({
      forecast_id: forecastId, user_id: B.id, attempt_id: attemptId, observed_correct: true, abs_error: 0.3,
    });
    if (evaluation.error) throw new Error(`B evaluation insert failed: ${evaluation.error.message}`);

    // ---- A tries to read B's data ----
    console.log('\nA reading B\'s rows');
    for (const table of ['concepts', 'recall_states', 'retrieval_attempts', 'study_sessions', 'forecast_log', 'forecast_evaluations']) {
      const byOwner = await A.client.from(table).select('*').eq('user_id', B.id);
      check(`${table}: select where user_id = B returns nothing`, !byOwner.error && rows(byOwner) === 0, byOwner.error?.message);
      const all = await A.client.from(table).select('*');
      check(`${table}: unfiltered select returns none of B's rows`, !all.error && rows(all) === 0, all.error?.message);
    }
    const profileRead = await A.client.from('profiles').select('*').eq('id', B.id);
    check('profiles: B\'s profile is not readable', !profileRead.error && rows(profileRead) === 0);

    // ---- A tries to change or delete B's data ----
    console.log('\nA writing to B\'s rows');
    await A.client.from('concepts').update({ answer: 'hacked' }).eq('id', conceptId);
    const afterUpdate = await admin.from('concepts').select('answer').eq('id', conceptId).single();
    check('concepts: update of B\'s row has no effect', afterUpdate.data?.answer === 'secret answer');

    await A.client.from('recall_states').update({ estimated_half_life_hours: 1 }).eq('concept_id', conceptId);
    const state = await admin.from('recall_states').select('estimated_half_life_hours').eq('concept_id', conceptId).single();
    check('recall_states: update of B\'s row has no effect', state.data?.estimated_half_life_hours === 30);

    await A.client.from('study_sessions').update({ status: 'abandoned' }).eq('id', sessionId);
    const sess = await admin.from('study_sessions').select('status').eq('id', sessionId).single();
    check('study_sessions: update of B\'s row has no effect', sess.data?.status === 'in_progress');

    await A.client.from('concepts').delete().eq('id', conceptId);
    await A.client.from('retrieval_attempts').delete().eq('id', attemptId);
    const stillThere = await admin.from('concepts').select('id').eq('id', conceptId);
    const attemptStillThere = await admin.from('retrieval_attempts').select('id').eq('id', attemptId);
    check('concepts: delete of B\'s row has no effect', rows(stillThere) === 1);
    check('retrieval_attempts: delete of B\'s row has no effect (append-only)', rows(attemptStillThere) === 1);

    // attaching A's rows to B's concept must be refused (migration 006)
    const planted = await A.client.from('retrieval_attempts').insert({
      user_id: A.id, concept_id: conceptId, presented_at: now.toISOString(), answered_at: now.toISOString(),
      predicted_recall_probability: 0.5, actual_correctness: true, response_latency_ms: 1, model_version: 'm',
      scheduler_version: 's', review_mode: 'due',
    });
    check('retrieval_attempts: A cannot attach an attempt to B\'s concept', planted.error !== null);
    const plantedState = await A.client.from('recall_states').insert({
      concept_id: conceptId, user_id: A.id, model_version: 'm', estimated_half_life_hours: 1,
    });
    check('recall_states: A cannot attach a state to B\'s concept', plantedState.error !== null);
    const forged = await A.client.from('concepts').insert({
      user_id: B.id, subject: 'x', prompt: 'forged', answer: 'x', difficulty: 1,
    });
    check('concepts: A cannot insert a row owned by B', forged.error !== null);

    // ---- the forecast log is immutable even for its owner ----
    console.log('\nforecast log immutability (as the owner, B)');
    await B.client.from('forecast_log').update({ predicted_probability: 0.01 }).eq('id', forecastId);
    const logRow = await admin.from('forecast_log').select('predicted_probability').eq('id', forecastId).single();
    check('forecast_log: owner UPDATE is denied', logRow.data?.predicted_probability === 0.7);
    await B.client.from('forecast_log').delete().eq('id', forecastId);
    const logStill = await admin.from('forecast_log').select('id').eq('id', forecastId);
    check('forecast_log: owner DELETE is denied', rows(logStill) === 1);
    await B.client.from('forecast_evaluations').update({ abs_error: 0 }).eq('forecast_id', forecastId);
    const evalRow = await admin.from('forecast_evaluations').select('abs_error').eq('forecast_id', forecastId).single();
    check('forecast_evaluations: owner UPDATE is denied', Math.abs((evalRow.data?.abs_error ?? 1) - 0.3) < 1e-6);

    // ---- RPCs ----
    console.log('\nRPCs');
    const dueA = await A.client.rpc('get_due_concepts');
    check('get_due_concepts as A returns none of B\'s concepts', !dueA.error && rows(dueA) === 0, dueA.error?.message);
    const dueB = await B.client.rpc('get_due_concepts');
    check('get_due_concepts as B returns B\'s own due concept', !dueB.error && rows(dueB) === 1, dueB.error?.message);
    const legacy = await A.client.rpc('get_due_concepts', { p_user_id: B.id });
    check('old p_user_id signature no longer exists (cannot target B)', legacy.error !== null || rows(legacy) === 0);
    const dashA = await A.client.rpc('get_dashboard_summary');
    const summaryA = Array.isArray(dashA.data) ? dashA.data[0] : dashA.data;
    check('get_dashboard_summary as A counts none of B\'s data', !dashA.error && Number(summaryA?.total_active_concepts ?? 0) === 0, dashA.error?.message);
    const legacyDash = await A.client.rpc('get_dashboard_summary', { p_user_id: B.id });
    check('get_dashboard_summary(p_user_id) no longer exists', legacyDash.error !== null);
    const crossTx = await A.client.rpc('submit_review_tx', {
      p_attempt: {
        concept_id: conceptId, client_request_id: randomUUID(), presented_at: now.toISOString(), answered_at: now.toISOString(),
        predicted_recall_probability: 0.5, actual_correctness: true, response_latency_ms: 1, model_version: 'm',
        scheduler_version: 's', review_mode: 'due',
      },
      p_state: { model_version: 'm', estimated_half_life_hours: 1, repetition_count: 1, successful_recall_count: 1, lapse_count: 0 },
    });
    check('submit_review_tx as A cannot write to B\'s concept', crossTx.error !== null);

    // ---- the anon role ----
    console.log('\nanonymous role');
    for (const fn of ['get_due_concepts', 'get_dashboard_summary']) {
      const r = await anon.rpc(fn);
      check(`${fn}: anon cannot execute`, r.error !== null, 'anon call succeeded');
    }
    const anonTx = await anon.rpc('submit_review_tx', { p_attempt: {}, p_state: {} });
    check('submit_review_tx: anon cannot execute', anonTx.error !== null);
    for (const table of ['concepts', 'retrieval_attempts', 'forecast_log']) {
      const r = await anon.from(table).select('*');
      check(`${table}: anon select returns nothing`, rows(r) === 0);
    }

    // ---- uploaded sources (migration 007) ----
    console.log('\nuploaded sources');
    const srcId = randomUUID();
    const srcPath = `${B.id}/${srcId}.txt`;
    const srcRow = await B.client.from('sources').insert({
      id: srcId, user_id: B.id, subject: 'RLS', title: 'secret notes', kind: 'text', storage_path: srcPath,
      byte_size: 20, sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    });
    if (srcRow.error) throw new Error(`B source insert failed: ${srcRow.error.message}`);
    const ingest = await B.client.rpc('ingest_source_tx', {
      p_source_id: srcId, p_unit_count: 1,
      p_sections: [{ ordinal: 0, level: 1, heading: 'secret heading', text: 'secret body', location: {} }],
      p_terms: [{ term: 'secret term', definition: 'secret definition', section_ordinal: 0, location: {}, score: 1 }],
    });
    if (ingest.error) throw new Error(`B ingest_source_tx failed: ${ingest.error.message}`);
    const upload = await B.client.storage.from('sources').upload(srcPath, new Blob(['secret body']), { contentType: 'text/plain' });
    if (upload.error) throw new Error(`B storage upload failed: ${upload.error.message}`);

    for (const table of ['sources', 'source_sections', 'source_terms']) {
      const byOwner = await A.client.from(table).select('*').eq('user_id', B.id);
      check(`${table}: A cannot read B's rows`, !byOwner.error && rows(byOwner) === 0, byOwner.error?.message);
      const all = await A.client.from(table).select('*');
      check(`${table}: unfiltered select returns none of B's rows`, !all.error && rows(all) === 0, all.error?.message);
    }
    await A.client.from('sources').update({ title: 'hacked' }).eq('id', srcId);
    const titleAfter = await admin.from('sources').select('title').eq('id', srcId).single();
    check('sources: update of B\'s row has no effect', titleAfter.data?.title === 'secret notes');
    await A.client.from('sources').delete().eq('id', srcId);
    await A.client.from('source_sections').delete().eq('source_id', srcId);
    await A.client.from('source_terms').delete().eq('source_id', srcId);
    const srcStill = await admin.from('sources').select('id').eq('id', srcId);
    const secStill = await admin.from('source_sections').select('id').eq('source_id', srcId);
    const termStill = await admin.from('source_terms').select('id').eq('source_id', srcId);
    check('sources: A cannot delete B\'s source', rows(srcStill) === 1);
    check('source_sections: A cannot delete B\'s sections', rows(secStill) === 1);
    check('source_terms: A cannot delete B\'s terms', rows(termStill) === 1);

    const plantedSection = await A.client.from('source_sections').insert({
      source_id: srcId, user_id: A.id, ordinal: 9, heading: 'x', text: 'y', char_count: 1,
    });
    check('source_sections: A cannot attach a section to B\'s source', plantedSection.error !== null);
    const plantedTerm = await A.client.from('source_terms').insert({ source_id: srcId, user_id: A.id, term: 'x' });
    check('source_terms: A cannot attach a term to B\'s source', plantedTerm.error !== null);
    const plantedConcept = await A.client.from('concepts').insert({
      user_id: A.id, subject: 'x', prompt: 'p', answer: 'a', difficulty: 1, source_id: srcId,
    });
    check('concepts: A cannot point a concept at B\'s source', plantedConcept.error !== null);
    const crossIngest = await A.client.rpc('ingest_source_tx', { p_source_id: srcId, p_unit_count: 1, p_sections: [], p_terms: [] });
    check('ingest_source_tx as A cannot write to B\'s source', crossIngest.error !== null);
    const anonIngest = await anon.rpc('ingest_source_tx', { p_source_id: srcId, p_unit_count: 1, p_sections: [], p_terms: [] });
    check('ingest_source_tx: anon cannot execute', anonIngest.error !== null);
    const anonSources = await anon.from('sources').select('*');
    check('sources: anon select returns nothing', rows(anonSources) === 0);

    // stored files: the private bucket is scoped to {user_id}/ folders
    const list = await A.client.storage.from('sources').list(B.id);
    check('storage: A cannot list B\'s folder', !list.error && (list.data ?? []).length === 0, list.error?.message);
    const download = await A.client.storage.from('sources').download(srcPath);
    check('storage: A cannot download B\'s file', download.error !== null);
    const plantedFile = await A.client.storage.from('sources').upload(`${B.id}/planted.txt`, new Blob(['x']));
    check('storage: A cannot upload into B\'s folder', plantedFile.error !== null);
    await A.client.storage.from('sources').remove([srcPath]);
    const fileStill = await B.client.storage.from('sources').download(srcPath);
    check('storage: A cannot delete B\'s file', fileStill.error === null);
    const publicUrl = await fetch(`${url}/storage/v1/object/public/sources/${srcPath}`);
    check('storage: the bucket is private (public URL does not serve the file)', !publicUrl.ok, `${publicUrl.status}`);
    await B.client.storage.from('sources').remove([srcPath]);

    // ---- exams and source groups (migrations 008, 009) ----
    console.log('\nexams and source groups');
    const examId = randomUUID();
    const examIns = await B.client.from('exams').insert({ id: examId, user_id: B.id, subject: 'RLS', name: 'secret exam', exam_date: '2099-01-01' });
    if (examIns.error) throw new Error(`B exam insert failed: ${examIns.error.message}`);
    const groupId = randomUUID();
    const groupIns = await B.client.from('source_groups').insert({ id: groupId, user_id: B.id, title: 'secret playlist' });
    if (groupIns.error) throw new Error(`B source_groups insert failed: ${groupIns.error.message}`);
    for (const table of ['exams', 'source_groups']) {
      const all = await A.client.from(table).select('*');
      check(`${table}: A cannot read B's rows`, !all.error && rows(all) === 0, all.error?.message);
      const anonRows = await anon.from(table).select('*');
      check(`${table}: anon select returns nothing`, rows(anonRows) === 0);
    }
    await A.client.from('exams').update({ name: 'hacked' }).eq('id', examId);
    const examAfter = await admin.from('exams').select('name').eq('id', examId).single();
    check('exams: update of B\'s row has no effect', examAfter.data?.name === 'secret exam');
    await A.client.from('exams').delete().eq('id', examId);
    await A.client.from('source_groups').delete().eq('id', groupId);
    check('exams: A cannot delete B\'s exam', rows(await admin.from('exams').select('id').eq('id', examId)) === 1);
    check('source_groups: A cannot delete B\'s group', rows(await admin.from('source_groups').select('id').eq('id', groupId)) === 1);
    const plantedExam = await A.client.from('exams').insert({ user_id: B.id, subject: 'x', name: 'x', exam_date: '2099-01-01' });
    check('exams: A cannot create an exam for B', plantedExam.error !== null);
    const intoBGroup = await A.client.from('sources').insert({
      user_id: A.id, subject: 'x', title: 'x', kind: 'youtube', storage_path: 'youtube:abcdefghijk', byte_size: 0,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), group_id: groupId,
    });
    check('sources: A cannot place a source in B\'s group', intoBGroup.error !== null);
    const ownYoutube = await A.client.from('sources').insert({
      user_id: A.id, subject: 'x', title: 'a video', kind: 'youtube', storage_path: 'youtube:abcdefghijk', byte_size: 0,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), source_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    check('sources: the youtube kind is accepted for one\'s own source', ownYoutube.error === null, ownYoutube.error?.message);

    // ---- is_demo cannot be self-assigned ----
    console.log('\nprofile flags');
    await A.client.from('profiles').update({ is_demo: true }).eq('id', A.id);
    const profile = await admin.from('profiles').select('is_demo').eq('id', A.id).single();
    check('profiles: a user cannot set is_demo on themself', profile.data?.is_demo === false);
  } finally {
    // Cascades remove every row the throwaway users created.
    await admin.auth.admin.deleteUser(A.id);
    await admin.auth.admin.deleteUser(B.id);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
