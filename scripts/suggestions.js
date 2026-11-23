import { supabase } from "./config.js";

const SUGGESTION_IMAGE_BUCKET = "suggestion-images";
const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const suggestionForm = document.getElementById("suggestion-form");
const suggestionLoginPrompt = document.getElementById(
  "suggestion-login-prompt"
);
const suggestionMessage = document.getElementById("suggestion-message");
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
const imageInput = document.getElementById("suggestion-images");
const imagePreview = document.getElementById(
  "suggestion-image-preview"
);

const seoulDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

let currentUser = null;
let currentRole = null;
let suggestions = [];
let previewUrls = [];

refreshButton.addEventListener("click", loadSuggestions);
suggestionForm.addEventListener("submit", submitSuggestion);
imageInput.addEventListener("change", renderSelectedImagePreview);

suggestionList.addEventListener("click", (event) => {
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

function isSuggestionOwner(suggestion) {
  return Boolean(
    currentUser &&
    suggestion &&
    String(suggestion.user_id) === String(currentUser.id)
  );
}

function canDeleteSuggestion(suggestion) {
  return Boolean(
    currentUser &&
    suggestion &&
    (currentRole === "admin" || isSuggestionOwner(suggestion))
  );
}

function normalizeImagePaths(value) {
  return Array.isArray(value)
    ? value.filter((path) => typeof path === "string" && path)
    : [];
}

function validateImageFiles(files) {
  if (files.length > MAX_IMAGE_COUNT) {
    return `사진은 최대 ${MAX_IMAGE_COUNT}장까지 첨부할 수 있습니다.`;
  }

  for (const file of files) {
    if (!IMAGE_EXTENSIONS[file.type]) {
      return "사진은 JPG, PNG, WEBP 형식만 첨부할 수 있습니다.";
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return `사진 한 장의 크기는 5MB 이하여야 합니다: ${file.name}`;
    }
  }

  return "";
}

function clearImagePreview() {
  for (const url of previewUrls) {
    URL.revokeObjectURL(url);
  }

  previewUrls = [];
  imagePreview.innerHTML = "";
  imagePreview.hidden = true;
}

function renderSelectedImagePreview() {
  clearImagePreview();

  const files = Array.from(imageInput.files ?? []);
  const validationMessage = validateImageFiles(files);

  if (validationMessage) {
    imageInput.value = "";
    showMessage(validationMessage, true);
    return;
  }

  if (files.length === 0) {
    return;
  }

  imagePreview.hidden = false;
  imagePreview.innerHTML = files
    .map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.push(previewUrl);

      return `
        <figure class="suggestion-image-preview-item">
          <img
            src="${escapeHtml(previewUrl)}"
            alt="첨부할 사진 ${index + 1} 미리보기"
          >
          <figcaption>${escapeHtml(file.name)}</figcaption>
        </figure>
      `;
    })
    .join("");
}

function renderSuggestionImages(suggestion) {
  const imagePaths = normalizeImagePaths(suggestion.image_paths);
  const imageUrls = Array.isArray(suggestion.image_urls)
    ? suggestion.image_urls
    : [];

  if (imageUrls.length > 0) {
    return `
      <div class="suggestion-post-images">
        ${imageUrls.map((url, index) => `
          <a
            href="${escapeHtml(url)}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="첨부 사진 ${index + 1} 크게 보기"
          >
            <img
              src="${escapeHtml(url)}"
              alt="건의사항 첨부 사진 ${index + 1}"
              loading="lazy"
            >
          </a>
        `).join("")}
      </div>
    `;
  }

  if (imagePaths.length > 0) {
    return `
      <p class="suggestion-image-error">
        첨부 사진을 불러오지 못했습니다. 최신 건의사항 SQL을 확인해 주세요.
      </p>
    `;
  }

  return "";
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
      const isOwner = isSuggestionOwner(suggestion);
      const canReadPrivateContent = isAdmin || isOwner;

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
            ${canDeleteSuggestion(suggestion)
              ? `
                <button
                  type="button"
                  class="suggestion-delete-button"
                  data-delete-suggestion-id="${escapeHtml(suggestion.id)}"
                  aria-label="${escapeHtml(suggestion.title)} 게시글 삭제"
                >삭제</button>
              `
              : ""}
          </header>
          ${canReadPrivateContent
            ? `
              <p class="suggestion-post-content">
                ${escapeHtml(suggestion.content)}
              </p>
              ${renderSuggestionImages(suggestion)}
            `
            : `
              <p class="suggestion-post-private">
                <span aria-hidden="true">🔒</span>
                본문과 사진은 관리자와 작성자만 확인할 수 있습니다.
              </p>
            `}
        </article>
      `;
    })
    .join("");
}

async function attachSignedImageUrls(items) {
  const paths = [...new Set(
    items.flatMap((suggestion) =>
      normalizeImagePaths(suggestion.image_paths)
    )
  )];

  if (paths.length === 0) {
    return;
  }

  const { data, error } = await supabase.storage
    .from(SUGGESTION_IMAGE_BUCKET)
    .createSignedUrls(paths, 60 * 60);

  if (error) {
    console.error("건의사항 사진 URL 생성 오류:", error);
    return;
  }

  const signedUrlByPath = new Map(
    (data ?? [])
      .filter((item) => item.signedUrl)
      .map((item) => [item.path, item.signedUrl])
  );

  for (const suggestion of items) {
    suggestion.image_urls = normalizeImagePaths(
      suggestion.image_paths
    )
      .map((path) => signedUrlByPath.get(path))
      .filter(Boolean);
  }
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
        image_paths,
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
          image_paths,
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

  if (error) {
    suggestionList.removeAttribute("aria-busy");
    suggestionList.innerHTML = `
      <div class="suggestion-empty is-error">
        <strong>건의사항을 불러오지 못했습니다.</strong>
        <p>Supabase에서 최신 건의사항 SQL을 다시 실행했는지 확인해 주세요.</p>
      </div>
    `;
    showMessage(`건의사항 조회 오류: ${error.message}`, true);
    return;
  }

  suggestions = data ?? [];
  await attachSignedImageUrls(suggestions);
  suggestionList.removeAttribute("aria-busy");
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
  const imageFiles = Array.from(imageInput.files ?? []);
  const validationMessage = validateImageFiles(imageFiles);

  if (!title || !content) {
    showMessage("제목과 내용을 모두 입력해 주세요.", true);
    return;
  }

  if (validationMessage) {
    showMessage(validationMessage, true);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = imageFiles.length > 0
    ? "사진 업로드 중..."
    : "등록 중...";
  showMessage("");

  const suggestionId = crypto.randomUUID();
  const uploadedPaths = [];

  try {
    for (const file of imageFiles) {
      const extension = IMAGE_EXTENSIONS[file.type];
      const path =
        `${currentUser.id}/${suggestionId}/` +
        `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(SUGGESTION_IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      uploadedPaths.push(path);
    }

    submitButton.textContent = "등록 중...";

    const { error: insertError } = await supabase
      .from("suggestions")
      .insert({
        id: suggestionId,
        title,
        content,
        image_paths: uploadedPaths
      });

    if (insertError) {
      throw insertError;
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage
        .from(SUGGESTION_IMAGE_BUCKET)
        .remove(uploadedPaths);
    }

    submitButton.disabled = false;
    submitButton.textContent = "건의 접수";
    showMessage(`게시글 등록 오류: ${error.message}`, true);
    return;
  }

  suggestionForm.reset();
  clearImagePreview();
  submitButton.disabled = false;
  submitButton.textContent = "건의 접수";
  showMessage(
    "건의사항이 접수되었습니다. 본문과 사진은 관리자와 작성자만 확인할 수 있습니다."
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
    `“${suggestion.title}” 게시글을 삭제할까요? 첨부 사진도 함께 삭제됩니다.`
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

  const imagePaths = normalizeImagePaths(suggestion.image_paths);
  const { error: imageDeleteError } = imagePaths.length > 0
    ? await supabase.storage
      .from(SUGGESTION_IMAGE_BUCKET)
      .remove(imagePaths)
    : { error: null };

  showMessage(imageDeleteError
    ? `게시글은 삭제됐지만 사진 정리 중 오류가 발생했습니다: ${imageDeleteError.message}`
    : "게시글과 첨부 사진이 삭제되었습니다.",
    Boolean(imageDeleteError)
  );
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
