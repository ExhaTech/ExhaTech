<?php
/* Yurguen: API mínima — lee y escribe data/cobros.json (archivo plano) */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Admin-Email, X-Admin-Password');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$file = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'cobros.json';

function default_data() {
    return array(
        'settings' => array(
            'adminEmail' => 'admin@exhatech.com',
            'adminPassword' => 'ExhaTech.2026!',
            'defaultExchangeRate' => 520,
            'retentionMonths' => 24,
            'autoPurge' => true
        ),
        'clients' => array(),
        'services' => array(),
        'payments' => array()
    );
}

function load_data($file) {
    if (!file_exists($file)) {
        $d = default_data();
        $dir = dirname($file);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        file_put_contents($file, json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return $d;
    }
    $raw = file_get_contents($file);
    $d = json_decode($raw, true);
    return is_array($d) ? $d : default_data();
}

function save_data($file, $data) {
    file_put_contents(
        $file,
        json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );
}

function get_admin_email($data) {
    $s = isset($data['settings']) ? $data['settings'] : array();
    return isset($s['adminEmail']) ? $s['adminEmail'] : 'admin@exhatech.com';
}

function get_admin_password($data) {
    $s = isset($data['settings']) ? $data['settings'] : array();
    return isset($s['adminPassword']) ? $s['adminPassword'] : 'ExhaTech.2026!';
}

function auth_ok($data, $email, $password) {
    return $email !== '' && $password !== ''
        && $email === get_admin_email($data)
        && $password === get_admin_password($data);
}

function public_settings($data) {
    $s = isset($data['settings']) ? $data['settings'] : array();
    return array(
        'defaultExchangeRate' => isset($s['defaultExchangeRate'])
            ? (float) $s['defaultExchangeRate']
            : 520,
        'retentionMonths' => isset($s['retentionMonths']) ? (int) $s['retentionMonths'] : 24,
        'autoPurge' => !isset($s['autoPurge']) || $s['autoPurge'] !== false
    );
}

function strip_secrets($data) {
    $out = $data;
    $out['settings'] = public_settings($data);
    return $out;
}

$email = isset($_SERVER['HTTP_X_ADMIN_EMAIL']) ? $_SERVER['HTTP_X_ADMIN_EMAIL'] : '';
$password = isset($_SERVER['HTTP_X_ADMIN_PASSWORD']) ? $_SERVER['HTTP_X_ADMIN_PASSWORD'] : '';
$data = load_data($file);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = isset($_GET['action']) ? $_GET['action'] : 'data';
    if ($action === 'auth') {
        echo json_encode(array('ok' => auth_ok($data, $email, $password)));
        exit;
    }
    if (!auth_ok($data, $email, $password)) {
        http_response_code(401);
        echo json_encode(array('error' => 'unauthorized'));
        exit;
    }
    echo json_encode(strip_secrets($data));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(array('error' => 'invalid body'));
        exit;
    }

    $action = isset($body['action']) ? $body['action'] : '';

    if ($action === 'auth') {
        $tryEmail = isset($body['email']) ? $body['email'] : '';
        $tryPass = isset($body['password']) ? $body['password'] : '';
        echo json_encode(array('ok' => auth_ok($data, $tryEmail, $tryPass)));
        exit;
    }

    if (!auth_ok($data, $email, $password)) {
        http_response_code(401);
        echo json_encode(array('error' => 'unauthorized'));
        exit;
    }

    if ($action === 'save') {
        $incoming = isset($body['data']) ? $body['data'] : null;
        if (!is_array($incoming)) {
            http_response_code(400);
            echo json_encode(array('error' => 'missing data'));
            exit;
        }
        $current = load_data($file);
        if (!isset($incoming['settings'])) {
            $incoming['settings'] = array();
        }
        $incoming['settings']['adminEmail'] = get_admin_email($current);
        $incoming['settings']['adminPassword'] = get_admin_password($current);
        if (!empty($body['newPassword'])) {
            $incoming['settings']['adminPassword'] = $body['newPassword'];
        }
        if (!isset($incoming['settings']['defaultExchangeRate'])) {
            $incoming['settings']['defaultExchangeRate'] = 520;
        }
        $incoming['clients'] = isset($incoming['clients']) ? $incoming['clients'] : array();
        $incoming['services'] = isset($incoming['services']) ? $incoming['services'] : array();
        $incoming['payments'] = isset($incoming['payments']) ? $incoming['payments'] : array();
        save_data($file, $incoming);
        echo json_encode(array('ok' => true));
        exit;
    }

    http_response_code(400);
    echo json_encode(array('error' => 'unknown action'));
    exit;
}

http_response_code(405);
echo json_encode(array('error' => 'method not allowed'));
