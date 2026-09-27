//! Diskort: DeepFilterNet 3 için wasm-bindgen'siz, düz C ABI'li wasm32 sarmalayıcısı.
//!
//! Modül hiçbir JS içe aktarımı gerektirmez; AudioWorklet tarafı yalnızca bellek ve
//! aşağıdaki fonksiyonlarla konuşur. Kare başına bellek ayırma yapılmaz.
use std::ptr::null_mut;
use std::sync::Mutex;

use df::tract::{DfParams, DfTract, RuntimeParams};
use ndarray::{ArrayView2, ArrayViewMut2};

/// DFN3 çıkarımı rastgelelik kullanmaz; tract-onnx-opl'nin getrandom bağımlılığı için sabit kaynak.
fn fixed_random(buf: &mut [u8]) -> Result<(), getrandom::Error> {
    let mut x: u32 = 0x9E37_79B9;
    for b in buf {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *b = x as u8;
    }
    Ok(())
}
getrandom::register_custom_getrandom!(fixed_random);

/// Son hata mesajı (UTF-8); `dfw_last_error_ptr/len` ile okunur.
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

fn set_error(msg: String) {
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = msg;
    }
}

#[no_mangle]
pub extern "C" fn dfw_last_error_ptr() -> *const u8 {
    LAST_ERROR.lock().map(|e| e.as_ptr()).unwrap_or(std::ptr::null())
}

#[no_mangle]
pub extern "C" fn dfw_last_error_len() -> usize {
    LAST_ERROR.lock().map(|e| e.len()).unwrap_or(0)
}

pub struct State {
    model: DfTract,
    input: Vec<f32>,
    output: Vec<f32>,
}

#[no_mangle]
pub extern "C" fn dfw_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` ve `len` `dfw_alloc` ile alınmış olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// Model arşivinden (DeepFilterNet3_onnx.tar.gz) durum oluşturur; hata olursa null döner.
///
/// # Safety
/// `model_ptr` `model_len` bayt geçerli bellek göstermeli.
#[no_mangle]
pub unsafe extern "C" fn dfw_create(
    model_ptr: *const u8,
    model_len: usize,
    atten_lim_db: f32,
    post_filter_beta: f32,
) -> *mut State {
    let bytes = std::slice::from_raw_parts(model_ptr, model_len);
    let params = match DfParams::from_bytes(bytes) {
        Ok(p) => p,
        Err(e) => {
            set_error(format!("model: {e:#}"));
            return null_mut();
        }
    };
    let rp = RuntimeParams::default_with_ch(1)
        .with_atten_lim(atten_lim_db)
        .with_post_filter(post_filter_beta.max(0.));
    let model = match DfTract::new(params, &rp) {
        Ok(m) => m,
        Err(e) => {
            set_error(format!("init: {e:#}"));
            return null_mut();
        }
    };
    let hop = model.hop_size;
    Box::into_raw(Box::new(State { model, input: vec![0.; hop], output: vec![0.; hop] }))
}

/// # Safety
/// `st` `dfw_create` ile alınmış olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_destroy(st: *mut State) {
    if !st.is_null() {
        drop(Box::from_raw(st));
    }
}

/// Kare uzunluğu (örnek sayısı; DFN3 için 480 = 10 ms @ 48 kHz).
///
/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_frame_length(st: *const State) -> usize {
    (*st).model.hop_size
}

/// Modelin ileri bakış (lookahead) kare sayısı.
///
/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_lookahead(st: *const State) -> usize {
    (*st).model.lookahead
}

/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_input_ptr(st: *mut State) -> *mut f32 {
    (*st).input.as_mut_ptr()
}

/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_output_ptr(st: *mut State) -> *mut f32 {
    (*st).output.as_mut_ptr()
}

/// Giriş tamponundaki bir kareyi işler, sonucu çıkış tamponuna yazar. Yerel SNR'yi döner (hata: NaN).
///
/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_process(st: *mut State) -> f32 {
    let s = &mut *st;
    let hop = s.model.hop_size;
    let (Ok(noisy), Ok(enh)) = (
        ArrayView2::from_shape((1, hop), &s.input[..]),
        ArrayViewMut2::from_shape((1, hop), &mut s.output[..]),
    ) else {
        return f32::NAN;
    };
    match s.model.process(noisy, enh) {
        Ok(lsnr) => lsnr,
        Err(e) => {
            set_error(format!("process: {e:#}"));
            f32::NAN
        }
    }
}

/// Bastırma sınırı (dB); 100 ve üstü sınırsız.
///
/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_set_atten_lim(st: *mut State, db: f32) {
    (*st).model.set_atten_lim(db);
}

/// Son filtre gücü (0 = kapalı, önerilen aralık 0–0.05).
///
/// # Safety
/// `st` geçerli olmalı.
#[no_mangle]
pub unsafe extern "C" fn dfw_set_post_filter_beta(st: *mut State, beta: f32) {
    (*st).model.set_pf_beta(beta);
}
