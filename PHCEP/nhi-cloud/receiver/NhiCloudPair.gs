function nhiCloudPair() {
  const ui = SpreadsheetApp.getUi();
  const prompt = ui.prompt('診所配對', '請貼上診所設定精靈產生的密鑰。不要使用 LINE 或舊 NHI token。', ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return;
  const key = prompt.getResponseText().trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
    ui.alert('密鑰格式不符，未更動設定。');
    return;
  }
  nhiWithLock_(function() {
    nhiPrepareSheet_();
    PropertiesService.getScriptProperties().setProperty('NHI_GATEWAY_SIGNING_SECRET', key);
  });
  ui.alert('已配對。請部署為網頁應用程式／以我執行／任何人，再於精靈驗證 /exec 網址。Sheet 不需公開。');
}
