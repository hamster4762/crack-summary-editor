// ==UserScript==
// @name         크랙 요약 메모리 텍스트 편집기
// @namespace    https://crack.wrtn.ai/
// @version      1.0.0
// @description  크랙의 장기 요약 메모리를 한꺼번에 편집하고 관리합니다. (version 관리방식: 크랙UI변경.기능추가및수정.핫픽스)
// @author       gemini
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-gen/v3/chats';
    let fetchedSummaries = []; // 원본 데이터 저장용

    // --- 유틸리티 함수 ---

    function getChatId() {
        const match = location.pathname.match(/\/episodes\/([a-f0-9]+)/);
        return match ? match[1] : null;
    }

    function getAccessToken() {
        const match = document.cookie.match(/(^| )access_token=([^;]+)/);
        return match ? match[2] : null;
    }

    async function apiRequest(method, path, body = null) {
        const chatId = getChatId();
        const token = getAccessToken();
        if (!chatId || !token) {
            console.error('Chat ID or Access Token not found');
            return null;
        }

        const url = `${API_BASE}/${chatId}${path}`;
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    // 편집창 텍스트 파싱
    function parseEditorContent(text) {
        const entries = [];
        // 빈 줄을 기준으로 블록 분리
        const blocks = text.split(/\n\s*\n/);

        for (const block of blocks) {
            const trimmedBlock = block.trim();
            if (!trimmedBlock) continue;

            const lines = trimmedBlock.split('\n');
            const headerLine = lines[0].trim();
            const contentLines = lines.slice(1);
            const summary = contentLines.join('\n').trim();

            // [제목] @id 또는 [제목] 형식 추출
            const headerMatch = headerLine.match(/^\[(.*?)\](?:\s*@([a-f0-9]+))?$/);
            if (headerMatch) {
                entries.push({
                    title: headerMatch[1].trim(),
                    id: headerMatch[2] || null,
                    summary: summary,
                    rawBlock: trimmedBlock,
                    isValidFormat: true
                });
            } else {
                // 형식이 맞지 않는 블록
                entries.push({
                    title: headerLine,
                    summary: summary,
                    rawBlock: trimmedBlock,
                    isValidFormat: false
                });
            }
        }
        return entries;
    }

    // 글자수 계산 (한글 1, 영어 1, 이모지 2)
    function getCharCount(str) {
        if (!str) return 0;
        return str.length;
    }

    // --- UI 생성 ---

    const styles = `
        #summary-editor-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 12px;
            height: 36px;
            border-radius: 6px;
            background: #2563eb;
            color: white;
            font-weight: 600;
            font-size: 13px;
            border: none;
            cursor: pointer;
            margin-right: 8px;
            transition: background 0.2s;
        }
        #summary-editor-btn:hover { background: #1d4ed8; }

        #summary-editor-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
        }

        #summary-editor-modal {
            background: white;
            width: 95vw;
            height: 90vh;
            max-width: 1400px;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            color: #1f2937;
        }

        .modal-header {
            padding: 16px 24px;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f9fafb;
        }

        .modal-header h2 { margin: 0; font-size: 18px; font-weight: 700; }

        .modal-body {
            flex: 1;
            display: flex;
            gap: 16px;
            padding: 16px;
            overflow: hidden;
        }

        .editor-pane, .preview-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
        }

        .pane-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .pane-label { font-size: 14px; font-weight: 600; color: #4b5563; }
        #selection-count { font-size: 12px; color: #6b7280; }

        #summary-edit-container {
            flex: 1;
            position: relative;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            overflow: hidden;
            background: white;
        }

        #summary-edit-area, #summary-edit-highlight {
            width: 100%;
            height: 100%;
            padding: 12px;
            margin: 0;
            border: none;
            font-family: 'JetBrains Mono', 'Fira Code', monospace;
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-all;
            box-sizing: border-box;
            position: absolute;
            top: 0;
            left: 0;
        }

        #summary-edit-area {
            resize: none;
            outline: none;
            color: #1f2937;
            background: transparent;
            z-index: 2;
            overflow-y: auto;
        }

        #summary-edit-highlight {
            color: transparent;
            z-index: 1;
            pointer-events: none;
            overflow-y: hidden; /* 스크롤은 textarea가 담당 */
        }

        .error-underline {
            text-decoration: underline wavy #ef4444;
            text-decoration-skip-ink: none;
        }

        #summary-preview-area {
            flex: 1;
            width: 100%;
            padding: 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            background: #f3f4f6;
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            overflow-y: auto;
            white-space: pre-wrap;
        }

        .diff-added { background-color: #dcfce7; color: #166534; padding: 2px 4px; border-radius: 2px; }
        .diff-modified { background-color: #fef9c3; color: #854d0e; padding: 2px 4px; border-radius: 2px; }
        .diff-deleted { background-color: #fee2e2; color: #991b1b; padding: 2px 4px; border-radius: 2px; text-decoration: line-through; }
        .error-text { color: #ef4444; font-weight: bold; }
        .error-block { border: 1px solid #fca5a5; background-color: #fff5f5; padding: 8px; border-radius: 4px; }

        .modal-footer {
            padding: 16px 24px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            background: #f9fafb;
        }

        .btn {
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid #d1d5db;
            background: white;
            transition: all 0.2s;
        }
        .btn:hover { background: #f3f4f6; }
        .btn-primary { background: #2563eb; color: white; border-color: #2563eb; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-primary:disabled { background: #94a3b8; border-color: #94a3b8; cursor: not-allowed; }
        .btn:disabled:not(.btn-primary) { opacity: 0.5; cursor: not-allowed; }
    `;

    function injectStyles() {
        const styleSheet = document.createElement("style");
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }

    let initialEditorValue = '';

    function createModal() {
        if (document.getElementById('summary-editor-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'summary-editor-modal-overlay';
        overlay.innerHTML = `
            <div id="summary-editor-modal">
                <div class="modal-header">
                    <h2>요약 메모리 편집기</h2>
                    <button id="summary-close-x" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="editor-pane">
                        <div class="pane-header">
                            <div class="pane-label">편집창 (형식: [제목] @id)</div>
                            <div id="selection-count"></div>
                        </div>
                        <div id="summary-edit-container">
                            <div id="summary-edit-highlight"></div>
                            <textarea id="summary-edit-area" spellcheck="false" placeholder="[제목] @id\n내용\n\n[새 제목]\n내용"></textarea>
                        </div>
                    </div>
                    <div class="preview-pane">
                        <div class="pane-header">
                            <div class="pane-label">미리보기 (Diff)</div>
                            <div id="change-summary" style="font-size: 12px; color: #6b7280;"></div>
                        </div>
                        <div id="summary-preview-area"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="summary-preview-btn" class="btn">미리보기</button>
                    <button id="summary-save-btn" class="btn btn-primary" disabled>저장</button>
                    <button id="summary-close-btn" class="btn">닫기</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const editor = document.getElementById('summary-edit-area');
        const highlight = document.getElementById('summary-edit-highlight');
        const saveBtn = document.getElementById('summary-save-btn');

        // 스크롤 동기화
        editor.onscroll = () => {
            highlight.scrollTop = editor.scrollTop;
        };

        editor.oninput = () => {
            updateHighlights();
            saveBtn.disabled = true;
        };

        const updateSelectionCount = () => {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const selectedText = editor.value.substring(start, end);
            const countEl = document.getElementById('selection-count');
            if (selectedText) {
                countEl.innerText = `(드래그: ${getCharCount(selectedText)}자)`;
            } else {
                countEl.innerText = '';
            }
        };

        editor.onmouseup = updateSelectionCount;
        editor.onkeyup = updateSelectionCount;

        // 이벤트 바인딩
        document.getElementById('summary-preview-btn').onclick = showPreview;
        document.getElementById('summary-save-btn').onclick = saveChanges;
        document.getElementById('summary-close-btn').onclick = handleClose;
        document.getElementById('summary-close-x').onclick = handleClose;

        // 자동 불러오기
        loadSummaries();
    }

    function handleClose() {
        const editor = document.getElementById('summary-edit-area');
        if (editor && editor.value !== initialEditorValue) {
            if (!confirm('변경사항이 있습니다. 저장하지 않고 닫으시겠습니까?')) {
                return;
            }
        }
        closeModal();
    }

    function updateHighlights() {
        const editor = document.getElementById('summary-edit-area');
        const highlight = document.getElementById('summary-edit-highlight');
        const text = editor.value;

        // 블록 단위 하이라이팅
        let finalHtml = '';
        const fullBlocks = text.split(/(\n\s*\n)/);
        
        fullBlocks.forEach(block => {
            if (block.match(/^\n\s*\n$/)) {
                finalHtml += block;
                return;
            }
            
            const lines = block.split('\n');
            const header = lines[0];
            const body = lines.slice(1).join('\n');
            
            const headerMatch = header.match(/^(\[(.*?)\])(?:\s*@([a-f0-9]+))?$/);
            
            // 1. 형식 오류 체크
            if (!headerMatch) {
                finalHtml += `<span class="error-underline">${block}</span>`;
                return;
            }

            const title = headerMatch[2];
            const titleLen = getCharCount(title);
            const trimmedBody = body.trim();
            const bodyLen = getCharCount(trimmedBody);
            
            const isTitleError = titleLen > 20 || titleLen === 0;
            const isBodyError = bodyLen > 300 || bodyLen === 0;

            // 제목 하이라이트 (내용이 아예 없는 경우에도 제목에 하이라이트하여 인지시킴)
            const shouldUnderlineHeader = isTitleError || (isBodyError && lines.length === 1);
            if (shouldUnderlineHeader) {
                finalHtml += `<span class="error-underline">${header}</span>`;
            } else {
                finalHtml += header;
            }
            
            if (lines.length > 1) {
                finalHtml += '\n';
                // 내용 하이라이트
                if (isBodyError) {
                    finalHtml += `<span class="error-underline">${body}</span>`;
                } else {
                    finalHtml += body;
                }
            }
        });

        // HTML 엔티티 이스케이프 및 줄바꿈 처리
        highlight.innerHTML = finalHtml
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/&lt;span class="error-underline"&gt;/g, '<span class="error-underline">')
            .replace(/&lt;\/span&gt;/g, '</span>')
            .replace(/\n/g, '<br>') + (text.endsWith('\n') ? '<br>' : '');
    }

    function closeModal() {
        const overlay = document.getElementById('summary-editor-modal-overlay');
        if (overlay) overlay.remove();
    }

    // --- 비즈니스 로직 ---

    async function getSummaries() {
        const summaries = [];
        const maxLoop = 100;
        let cursor = null;
        for (let i = 0; i < maxLoop; i++) {
            const params = new URLSearchParams({
                limit: 20,
                type: 'longTerm',
                orderBy: 'oldest',
                filter: 'all',
                ...(cursor && { cursor })
            });

            const res = await apiRequest('GET', `/summaries?${params}`);
            if (!res || !res.data || !res.data.summaries) break;
            
            summaries.push(...res.data.summaries);
            
            if (!res.data.nextCursor) {
                return summaries;
            }
            cursor = res.data.nextCursor;
        }
        return summaries;
    }

    async function loadSummaries() {
        const editor = document.getElementById('summary-edit-area');
        if (editor) {
            editor.disabled = true;
            editor.value = '불러오는 중...';
        }

        try {
            const summaries = await getSummaries();
            if (summaries) {
                fetchedSummaries = summaries;
                initialEditorValue = fetchedSummaries.map(s => `[${s.title}] @${s._id}\n${s.summary}`).join('\n\n');
                if (editor) {
                    editor.disabled = false;
                    editor.value = initialEditorValue;
                    updateHighlights();
                    showPreview();
                }
            }
        } catch (error) {
            console.error(error);
            alert('오류가 발생했습니다: ' + error.message);
        }
    }

    function showPreview() {
        const editorValue = document.getElementById('summary-edit-area').value;
        const parsed = parseEditorContent(editorValue);
        const previewArea = document.getElementById('summary-preview-area');
        const saveBtn = document.getElementById('summary-save-btn');
        previewArea.innerHTML = '';

        const fetchedMap = new Map(fetchedSummaries.map(s => [s._id, s]));
        const parsedIds = new Set(parsed.map(p => p.id).filter(id => id));

        let hasAnyError = false;
        let modCount = 0;
        let addCount = 0;
        let delCount = 0;

        // 1. 수정 및 추가 확인
        parsed.forEach(p => {
            const div = document.createElement('div');
            div.style.marginBottom = '12px';

            if (!p.isValidFormat) {
                hasAnyError = true;
                div.className = 'error-block';
                div.innerHTML = `<span class="error-text">형식 오류:</span><br>${p.rawBlock}`;
                previewArea.appendChild(div);
                return;
            }

            const titleLen = getCharCount(p.title);
            const summaryLen = getCharCount(p.summary);
            const isTitleError = titleLen > 20 || titleLen === 0;
            const isSummaryError = summaryLen > 300 || summaryLen === 0;
            if (isTitleError || isSummaryError) hasAnyError = true;

            if (p.id && fetchedMap.has(p.id)) {
                const original = fetchedMap.get(p.id);
                const titleChanged = original.title !== p.title;
                const summaryChanged = original.summary !== p.summary;

                if (titleChanged || summaryChanged) {
                    modCount++;
                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'diff-modified';
                    titleSpan.innerText = `[${original.title} -> ${p.title}] @${p.id}`;
                    if (titleLen > 20) titleSpan.innerHTML += ` <span class="error-text">(제목 초과: ${titleLen}/20)</span>`;
                    if (titleLen === 0) titleSpan.innerHTML += ` <span class="error-text">(제목 비어있음)</span>`;
                    div.appendChild(titleSpan);
                    div.appendChild(document.createTextNode('\n'));

                    if (summaryChanged) {
                        const oldSummary = document.createElement('div');
                        oldSummary.style.color = '#9ca3af';
                        oldSummary.innerText = original.summary;
                        div.appendChild(oldSummary);

                        const newSummary = document.createElement('div');
                        newSummary.className = 'diff-modified';
                        newSummary.innerText = p.summary;
                        if (summaryLen > 300) newSummary.innerHTML += ` <span class="error-text">(내용 초과: ${summaryLen}/300)</span>`;
                        if (summaryLen === 0) newSummary.innerHTML += ` <span class="error-text">(내용 비어있음)</span>`;
                        div.appendChild(newSummary);
                    } else {
                        div.appendChild(document.createTextNode(p.summary));
                    }
                } else {
                    div.innerText = `[${p.title}] @${p.id}\n${p.summary}`;
                }
            } else if (!p.id) {
                addCount++;
                const titleSpan = document.createElement('span');
                titleSpan.className = 'diff-added';
                titleSpan.innerText = `[${p.title}] (신규)`;
                if (titleLen > 20) titleSpan.innerHTML += ` <span class="error-text">(제목 초과: ${titleLen}/20)</span>`;
                if (titleLen === 0) titleSpan.innerHTML += ` <span class="error-text">(제목 비어있음)</span>`;
                div.appendChild(titleSpan);
                div.appendChild(document.createTextNode('\n'));

                const contentSpan = document.createElement('span');
                contentSpan.className = 'diff-added';
                contentSpan.innerText = p.summary;
                if (summaryLen > 300) contentSpan.innerHTML += ` <span class="error-text">(내용 초과: ${summaryLen}/300)</span>`;
                if (summaryLen === 0) contentSpan.innerHTML += ` <span class="error-text">(내용 비어있음)</span>`;
                div.appendChild(contentSpan);
            } else {
                div.innerText = `[${p.title}] @${p.id} (존재하지 않는 ID)\n${p.summary}`;
                div.style.color = '#dc2626';
                hasAnyError = true;
            }
            previewArea.appendChild(div);
        });

        // 2. 삭제 확인
        fetchedSummaries.forEach(s => {
            if (!parsedIds.has(s._id)) {
                delCount++;
                const div = document.createElement('div');
                div.style.marginBottom = '12px';
                const titleSpan = document.createElement('span');
                titleSpan.className = 'diff-deleted';
                titleSpan.innerText = `[${s.title}] @${s._id} (삭제됨)`;
                div.appendChild(titleSpan);
                div.appendChild(document.createTextNode('\n'));
                const contentDiv = document.createElement('div');
                contentDiv.className = 'diff-deleted';
                contentDiv.innerText = s.summary;
                div.appendChild(contentDiv);
                previewArea.appendChild(div);
            }
        });

        const originalCount = fetchedSummaries.length;
        const finalCount = parsed.length;
        const summaryEl = document.getElementById('change-summary');
        if (summaryEl) {
            summaryEl.innerText = `(수정: ${modCount}건, 삭제: ${delCount}건, 추가: ${addCount}건) 요약 메모리 개수: ${originalCount} 건 -> ${finalCount}건`;
        }

        saveBtn.disabled = hasAnyError;
    }

    async function saveChanges() {
        const editorValue = document.getElementById('summary-edit-area').value;
        const parsed = parseEditorContent(editorValue);
        
        const fetchedMap = new Map(fetchedSummaries.map(s => [s._id, s]));
        const parsedIds = new Set(parsed.map(p => p.id).filter(id => id));

        const toUpdate = [];
        const toCreate = [];
        const toDelete = [];

        // 업데이트 및 생성 분류
        parsed.forEach((p, index) => {
            if (p.id && fetchedMap.has(p.id)) {
                const original = fetchedMap.get(p.id);
                if (original.title !== p.title || original.summary !== p.summary) {
                    toUpdate.push(p);
                }
            } else if (!p.id) {
                // 위치 정보 계산
                let position = null;
                // 위쪽에서 가장 가까운 ID 찾기
                for (let i = index - 1; i >= 0; i--) {
                    if (parsed[i].id) {
                        position = { referenceSummaryId: parsed[i].id, placement: 'below' };
                        break;
                    }
                }
                // 위쪽에 없으면 아래쪽에서 찾기
                if (!position) {
                    for (let i = index + 1; i < parsed.length; i++) {
                        if (parsed[i].id) {
                            position = { referenceSummaryId: parsed[i].id, placement: 'above' };
                            break;
                        }
                    }
                }
                toCreate.push({ ...p, position, originalIndex: index });
            }
        });

        // 삭제 분류
        fetchedSummaries.forEach(s => {
            if (!parsedIds.has(s._id)) {
                toDelete.push(s._id);
            }
        });

        const totalTasks = toUpdate.length + toCreate.length + toDelete.length;
        if (totalTasks === 0) {
            alert('변경사항이 없습니다.');
            return;
        }

        if (!confirm(`총 ${totalTasks}개의 변경사항을 저장하시겠습니까?`)) return;

        const btn = document.getElementById('summary-save-btn');
        btn.disabled = true;
        btn.innerText = '저장 중...';

        let successCount = 0;

        // 1. 삭제 먼저 수행
        for (const id of toDelete) {
            const res = await apiRequest('DELETE', `/summaries/${id}`);
            if (res) successCount++;
        }

        // 2. 업데이트 수행
        for (const item of toUpdate) {
            const res = await apiRequest('PATCH', `/summaries/${item.id}`, {
                title: item.title,
                summary: item.summary
            });
            if (res) successCount++;
        }

        // 3. 생성 수행 (순서 유지를 위해 역순 처리 로직이 필요할 수 있으나, 
        // 여기서는 단순하게 위에서 아래로 reference를 참조하여 생성)
        // 같은 referenceId를 가진 그룹은 역순으로 생성해야 의도한 순서가 됨
        const createGroups = new Map();
        toCreate.forEach(item => {
            const key = item.position ? `${item.position.referenceSummaryId}_${item.position.placement}` : 'none';
            if (!createGroups.has(key)) createGroups.set(key, []);
            createGroups.get(key).push(item);
        });

        for (const [key, items] of createGroups) {
            // placement가 below인 경우 역순으로 생성해야 순서가 유지됨 (ID -> N1 -> N2 순서라면 N2 생성 후 N1 생성)
            // 하지만 referenceId가 고정이라면 N1 생성 후 N2를 N1 아래에 생성해야 함.
            // 여기서는 referenceId가 기존 ID이므로, N2를 ID 아래에 먼저 만들고 N1을 ID 아래에 만들면 ID -> N1 -> N2가 됨.
            const sortedItems = (items[0].position?.placement === 'below') ? [...items].reverse() : items;
            
            for (const item of sortedItems) {
                const payload = {
                    title: item.title,
                    summary: item.summary,
                    type: 'longTerm',
                    orderBy: 'oldest'
                };
                if (item.position) payload.position = item.position;
                
                const res = await apiRequest('POST', '/summaries', payload);
                if (res) successCount++;
            }
        }

        alert(`${successCount} / ${totalTasks} 건의 작업이 완료되었습니다.`);
        await loadSummaries();
        btn.innerText = '저장';
    }

    // --- 버튼 주입 ---

    function injectButton() {
        // 상단 헤더 컨테이너 찾기
        const headerContainer = document.querySelector('.absolute.z-\\[5\\] .flex.gap-3.items-center');
        if (!headerContainer || document.getElementById('summary-editor-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'summary-editor-btn';
        btn.innerText = '요약 메모리 편집기';
        btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            createModal();
        };

        headerContainer.prepend(btn);
    }

    // 초기화
    function init() {
        injectStyles();
        
        // MutationObserver로 버튼이 사라지면 다시 주입
        const observer = new MutationObserver(() => {
            injectButton();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // 주기적 체크 (안전장치)
        setInterval(injectButton, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
