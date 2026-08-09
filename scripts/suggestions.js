import { supabase } from "./config.js";

const suggestionForm = document.getElementById("suggestion-form");
const suggestionLoginPrompt = document.getElementById(
  "suggestion-login-prompt"
);
const suggestionMessage = document.getElementById(
  "suggestion-message"
);
const suggestionList = document.getElementById("suggestion-list");
const suggestionCount = document.getElementById("suggestion-count");
const suggestionListTitle = document.getElementById(
  "suggestion-list-title"
);
const refreshButton = document.getElementById(
  "suggestion-refresh-button"
);
const authLink = document.getElementById("suggestion-auth-link");
const submitButton = document.getElementById(
  "suggestion-submit-button"
);
const formTitle = document.getElementById("suggestion-form-title");
const editCancelButton = document.getElementById(
  "suggestion-edit-cancel-button"
);

const seoulDateTimeFormatter = new Intl.DateTimeFormat(
  "ko-KR",
  {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }
);

let currentUser = null;
let currentRole = null;
let suggestions = [];
let editingSuggestionId = null;

refreshButton.addEventListener("click", loadSuggestions);

suggestionForm.addEventListener("submit", submitSuggestion);
editCancelButton.addEventListener("click", resetSuggestionEditor);

suggestionList.addEventListener("click", (event) => {
  const editButton = event.target.closest(
    "[data-edit-suggestion-id]"
  );

  if (editButton) {
    startEditingSuggestion(editButton.dataset.editSuggestionId);
    return;
  }

  const deleteButton = event.target.closest(
    "[data-delete-suggestion-id]"
  );

  if (!deleteButton) {
    return;
  }

  deleteSuggestion(deleteButton.dataset.deleteSuggestionId);
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return seoulDateTimeFormatter.format(new Date(value));
}

function showMessage(message, isError = false) {
  suggestionMessage.textContent = message;
  suggestionMessage.classList.toggle("error-message", isError);
  suggestionMessage.hidden = !message;
}

function maskName(value) {
  const characters = Array.from(
    String(value ?? "이용자").trim()
  );

  if (characters.length <= 1) {
    return `${characters[0] ?? "이"}*`;
  }

  if (characters.length === 2) {
    return `${characters[0]}*`;
  }

  return (
    characters[0] +
    "*".repeat(characters.length - 2) +
    characters.at(-1)
  );
}

function canDeleteSuggestion(suggestion) {
  return Boolean(
    currentUser &&
    suggestion &&
    (
      currentRole === "admin" ||
      String(suggestion.user_id) === String(currentUser.id)
    )
  );
}

function canEditSuggestion(suggestion) {
  return Boolean(
    currentUser &&
    suggestion &&
    String(suggestion.user_id) === String(currentUser.id)
  );
}

function resetSuggestionEditor() {
  editingSuggestionId = null;
  suggestionForm.reset();
  formTitle.textContent = "새 건의 작성";
  submitButton.textContent = "건의 접수";
  submitButton.disabled = false;
  editCancelButton.hidden = true;
}

function startEditingSuggestion(suggestionId) {
  const suggestion = suggestions.find(
    (item) => String(item.id) === String(suggestionId)
  );

  if (!suggestion || !canEditSuggestion(suggestion)) {
    showMessage("본인이 작성한 건의사항만 수정할 수 있습니다.", true);
    return;
  }

  editingSuggestionId = suggestion.id;
  document.getElementById("suggestion-title").value =
    suggestion.title ?? "";
  document.getElementById("suggestion-content").value =
    suggestion.content ?? "";
  formTitle.textContent = "건의사항 수정";
  submitButton.textContent = "수정 내용 저장";
  editCancelButton.hidden = false;
  showMessage("수정할 내용을 확인한 뒤 저장해 주세요.");

  document.getElementById("suggestion-form-card").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  document.getElementById("suggestion-title").focus({
    preventScroll: true
  });
}

function renderSuggestions() {
  const isAdmin = currentRole === "admin";

  suggestionListTitle.textContent = isAdmin
    ? "접수된 건의사항"
    : "등록된 건의사항";
  suggestionCount.textContent = `${suggestions.length}건`;
  refreshButton.hidden = false;

  if (suggestions.length === 0) {
    suggestionList.innerHTML = `
      <div class="suggestion-empty">
        <span aria-hidden="true">✦</span>
        <strong>아직 등록된 건의사항이 없습니다.</strong>
        <p>첫 번째 개선 아이디어를 남겨주세요.</p>
      </div>
    `;
    return;
  }

  suggestionList.innerHTML = suggestions
    .map((suggestion) => {
      const isOwner = canEditSuggestion(suggestion);

      return `
      <article class="suggestion-post">
        <header class="suggestion-post-header">
          <div>
            <h3>${escapeHtml(suggestion.title)}</h3>
            <p>
              <span>${escapeHtml(
                suggestion.masked_author_name ||
                maskName(suggestion.author_name)
              )}</span>
              <span aria-hidden="true">·</span>
              <time datetime="${escapeHtml(suggestion.created_at)}">
                ${escapeHtml(formatDateTime(suggestion.created_at))}
              </time>
              ${isOwner
                ? `<span class="suggestion-owner-badge">내가 작성</span>`
                : ""}
            </p>
          </div>
          <div class="suggestion-post-actions">
            ${isOwner
              ? `
                <button
                  type="button"
                  class="suggestion-edit-button"
                  data-edit-suggestion-id="${escapeHtml(suggestion.id)}"
                  aria-label="${escapeHtml(suggestion.title)} 게시글 수정"
                >
                  수정
                </button>
              `
              : ""}
            ${canDeleteSuggestion(suggestion)
              ? `
                <button
                  type="button"
                  class="suggestion-delete-button"
                  data-delete-suggestion-id="${escapeHtml(suggestion.id)}"
                  aria-label="${escapeHtml(suggestion.title)} 게시글 삭제"
                >
                  삭제
                </button>
              `
              : ""
            }
          </div>
        </header>
        ${
          isAdmin || isOwner
            ? `
              <p class="suggestion-post-content">
                ${escapeHtml(suggestion.content)}
              </p>
            `
            : `
              <p class="suggestion-post-private">
                <span aria-hidden="true">🔒</span>
                본문은 관리자와 작성자만 확인할 수 있습니다.
              </p>
            `
          }
      </article>
    `;
    })
    .join("");
}

async function loadSuggestions() {
  suggestionList.setAttribute("aria-busy", "true");

  let data = [];
  let error = null;

  if (currentRole === "admin") {
    const response = await supabase
      .from("suggestions")
      .select(`
        id,
        user_id,
        author_name,
        title,
        content,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    data = response.data ?? [];
    error = response.error;
  } else {
    const publicRequest = supabase
      .from("suggestion_public_list")
      .select(`
        id,
        masked_author_name,
        title,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);
    const ownRequest = currentUser
      ? supabase
        .from("suggestions")
        .select(`
          id,
          user_id,
          author_name,
          title,
          content,
          created_at
        `)
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(100)
      : Promise.resolve({ data: [], error: null });
    const [publicResponse, ownResponse] = await Promise.all([
      publicRequest,
      ownRequest
    ]);

    error = publicResponse.error || ownResponse.error;

    if (!error) {
      const ownSuggestions = new Map(
        (ownResponse.data ?? []).map((suggestion) => [
          String(suggestion.id),
          suggestion
        ])
      );

      data = (publicResponse.data ?? []).map(
        (suggestion) =>
          ownSuggestions.get(String(suggestion.id)) ?? suggestion
      );

      const publicIds = new Set(
        data.map((suggestion) => String(suggestion.id))
      );

      for (const suggestion of ownResponse.data ?? []) {
        if (!publicIds.has(String(suggestion.id))) {
          data.push(suggestion);
        }
      }

      data.sort(
        (first, second) =>
          new Date(second.created_at) - new Date(first.created_at)
      );
    }
  }

  suggestionList.removeAttribute("aria-busy");

  if (error) {
    suggestionList.innerHTML = `
      <div class="suggestion-empty is-error">
        <strong>건의사항을 불러오지 못했습니다.</strong>
        <p>Supabase에서 최신 건의사항 SQL을 다시 실행했는지 확인해 주세요.</p>
      </div>
    `;
    showMessage(
      `건의사항 조회 오류: ${error.message}`,
      true
    );
    return;
  }

  suggestions = data ?? [];
  renderSuggestions();
}

async function submitSuggestion(event) {
  event.preventDefault();

  if (!currentUser) {
    window.location.href = "./login.html";
    return;
  }

  const title = document
    .getElementById("suggestion-title")
    .value.trim();
  const content = document
    .getElementById("suggestion-content")
    .value.trim();

  if (!title || !content) {
    showMessage("제목과 내용을 모두 입력해 주세요.", true);
    return;
  }

  const isEditing = Boolean(editingSuggestionId);

  submitButton.disabled = true;
  submitButton.textContent = isEditing ? "수정 중..." : "등록 중...";
  showMessage("");

  let error = null;
  let updatedSuggestion = null;

  if (isEditing) {
    const response = await supabase
      .from("suggestions")
      .update({ title, content })
      .eq("id", editingSuggestionId)
      .eq("user_id", currentUser.id)
      .select("id")
      .maybeSingle();

    error = response.error;
    updatedSuggestion = response.data;
  } else {
    const response = await supabase
      .from("suggestions")
      .insert({ title, content });

    error = response.error;
  }

  if (error) {
    submitButton.disabled = false;
    submitButton.textContent = isEditing
      ? "수정 내용 저장"
      : "건의 접수";
    showMessage(
      `게시글 ${isEditing ? "수정" : "등록"} 오류: ${error.message}`,
      true
    );
    return;
  }

  if (isEditing && !updatedSuggestion) {
    submitButton.disabled = false;
    submitButton.textContent = "수정 내용 저장";
    showMessage("본인이 작성한 건의사항만 수정할 수 있습니다.", true);
    return;
  }

  resetSuggestionEditor();
  showMessage(isEditing
    ? "건의사항이 수정되었습니다."
    : "건의사항이 접수되었습니다. 제목과 가린 이름은 표시되며 본문은 관리자와 작성자만 확인할 수 있습니다."
  );

  await loadSuggestions();
}

async function deleteSuggestion(suggestionId) {
  const suggestion = suggestions.find(
    (item) => String(item.id) === String(suggestionId)
  );

  if (!suggestion || !canDeleteSuggestion(suggestion)) {
    showMessage("이 게시글을 삭제할 권한이 없습니다.", true);
    return;
  }

  const confirmed = window.confirm(
    `“${suggestion.title}” 게시글을 삭제할까요?`
  );

  if (!confirmed) {
    return;
  }

  const { error } = await supabase
    .from("suggestions")
    .delete()
    .eq("id", suggestion.id);

  if (error) {
    showMessage(`게시글 삭제 오류: ${error.message}`, true);
    return;
  }

  showMessage("게시글이 삭제되었습니다.");
  if (String(editingSuggestionId) === String(suggestion.id)) {
    resetSuggestionEditor();
  }
  await loadSuggestions();
}

async function initialize() {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  currentUser = user ?? null;

  if (currentUser) {
    const { data: permission } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    currentRole = permission?.role ?? null;
    suggestionForm.hidden = false;
    suggestionLoginPrompt.hidden = true;
    authLink.textContent = currentRole === "admin"
      ? "관리자 페이지"
      : "예약 페이지";
    authLink.href = currentRole === "admin"
      ? "./admin.html"
      : "./reservation.html";
  } else {
    suggestionForm.hidden = true;
    suggestionLoginPrompt.hidden = false;
  }

  await loadSuggestions();
}

initialize();
