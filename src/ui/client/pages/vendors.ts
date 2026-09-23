import { DEFAULT_PROBE_INTERVAL, DEFAULT_PROBE_TIMEOUT_MS } from "../../../config.ts";

/**
 * 供应商编辑片段：新增/编辑表单与删除确认。
 *
 * 依赖前序片段提供 token / api / t / el；渲染出的分组头按钮（renderVendors）调用
 * 这里暴露的 openVendorForm / askRemoveVendor。
 *
 * 密钥纪律：api_key 输入框**永远**是空的（placeholder 只提示 ${VAR} 写法），
 * 留空即表示不修改既有密钥 —— 界面与诊断都不回显明文。
 */
export function vendorsPageFragment(): string {
  return `
      /** 表单容器的固定 id；页面外壳提供这个空容器。 */
      var VENDOR_FORM_ID = "kuma-vendor-form";

      function field(labelKey, tag) {
        var wrap = document.createElement("label");
        wrap.className = "kuma-field";
        wrap.appendChild(text("span", "kuma-field-label", t(labelKey)));
        var input = document.createElement(tag || "input");
        if (tag === "textarea") {
          input.rows = 4;
        } else {
          input.type = "text";
        }
        wrap.appendChild(input);
        return { input: input, wrap: wrap };
      }

      function closeVendorForm() {
        var host = el(VENDOR_FORM_ID);
        if (!host) { return; }
        host.textContent = "";
        host.hidden = true;
      }

      /**
       * 打开表单。group 为 null 时是新增，否则预填该供应商的现值。
       *
       * 每次打开都重建表单：避免上一次的输入残留到下一次编辑。
       */
      function openVendorForm(group) {
        var host = el(VENDOR_FORM_ID);
        if (!host) { return; }
        host.textContent = "";
        host.hidden = false;

        var form = document.createElement("form");
        form.className = "kuma-vendor-form";
        form.appendChild(
          text("h3", "kuma-block-title", t(group ? "vendor.edit" : "vendor.newTitle"))
        );

        var name = field("vendor.name");
        name.input.value = group ? group.name : "";
        // 名称是配置里的定位键，改名等于换一个供应商：只读，避免误改导致重复条目
        name.input.readOnly = Boolean(group);
        form.appendChild(name.wrap);

        var endpoint = field("vendor.endpoint");
        endpoint.input.value = group && group.endpoint ? group.endpoint : "";
        form.appendChild(endpoint.wrap);

        var models = field("vendor.models", "textarea");
        models.input.value = group
          ? group.models.map(function (m) { return m.model; }).join("\\n")
          : "";
        form.appendChild(models.wrap);

        var apiKey = field("vendor.apiKey");
        // 恒为空：留空 = 不修改既有密钥，界面永不回显明文
        apiKey.input.value = "";
        form.appendChild(apiKey.wrap);

        var interval = field("vendor.interval");
        interval.input.value = "${DEFAULT_PROBE_INTERVAL}";
        form.appendChild(interval.wrap);

        var timeout = field("vendor.timeout");
        timeout.input.value = String(${DEFAULT_PROBE_TIMEOUT_MS});
        form.appendChild(timeout.wrap);

        form.appendChild(text("p", "kuma-field-hint", t("vendor.formHint")));

        var error = text("p", "kuma-form-error", "");
        error.hidden = true;
        form.appendChild(error);

        var actions = document.createElement("div");
        actions.className = "kuma-form-actions";
        var save = text("button", "", t("vendor.save"));
        save.type = "submit";
        var cancel = text("button", "", t("vendor.cancel"));
        cancel.type = "button";
        cancel.addEventListener("click", closeVendorForm);
        actions.appendChild(save);
        actions.appendChild(cancel);
        form.appendChild(actions);

        form.addEventListener("submit", function (event) {
          event.preventDefault();
          save.disabled = true;
          var payload = {
            apiKey: apiKey.input.value,
            endpoint: endpoint.input.value.trim(),
            models: splitModels(models.input.value),
            name: name.input.value.trim(),
            probeEnabled: true,
            probeInterval: interval.input.value.trim() || "${DEFAULT_PROBE_INTERVAL}",
            probeTimeout: Number(timeout.input.value) || ${DEFAULT_PROBE_TIMEOUT_MS},
          };
          api("/api/vendors/save", "POST", payload).then(
            function () {
              closeVendorForm();
              setStatus(t("vendor.saved"));
              return load();
            },
            function (failure) {
              save.disabled = false;
              error.textContent = t("vendor.saveFailed") + failure.message;
              error.hidden = false;
            }
          );
        });

        host.appendChild(form);
      }

      /** 多行 / 逗号分隔都接受；去重后保持输入顺序。 */
      function splitModels(raw) {
        var seen = {};
        var out = [];
        String(raw).split(/[\\n,]/).forEach(function (item) {
          var name = item.trim();
          if (name === "" || seen[name]) { return; }
          seen[name] = true;
          out.push(name);
        });
        return out;
      }

      /** 删除确认走浏览器原生 confirm：够用，且不必自造对话框。 */
      function askRemoveVendor(name) {
        if (!window.confirm(t("vendor.confirmRemove") + " " + name)) { return; }
        api("/api/vendors/delete", "POST", { name: name }).then(
          function () { return load(); },
          function (failure) {
            setStatus(t("vendor.saveFailed") + failure.message);
          }
        );
      }

      /** 「新增供应商」按钮：入口放在供应商面板的操作行。 */
      function wireAddVendor() {
        var btn = el("kuma-vendor-add");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
          openVendorForm(null);
        });
      }
  `;
}
