(function () {
	const qs = new URLSearchParams(window.location.search);
	const isTestEnv =
		qs.has('test') ||
		qs.get('env') === 'test' ||
		/test|staging/i.test(location.host || '');

	if (!isTestEnv) return;

	if (!document.getElementById('test-indicator')) {
		const banner = document.createElement('div');
		banner.id = 'test-indicator';
		banner.className = 'test-banner';
		banner.textContent = '⚠️ TEST OMGEVING ACTIEF';
		document.body.prepend(banner);
	}

	document.body.classList.add('is-test');
})();